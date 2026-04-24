"""
api/routes/discord.py — Discord integration HTTP surface.

Endpoints:
  GET   /config                              -- diagnostic (Phase 1)
  POST  /link-app-user/{discord_user_id}     -- admin: bind a Discord
                                                identity to an existing
                                                panel AppUser (so the
                                                next Discord OAuth login
                                                logs that AppUser in)
  DELETE /link-app-user/{discord_user_id}    -- admin: unbind
  GET   /accounts                            -- admin: list known
                                                Discord accounts +
                                                their links

Subsequent phases (3-6) add /link, /role-mappings, /sync, /me/dashboard.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.core.auth import require_admin
from app.core.config import server_settings
from app.db.models.app import AppUser
from app.db.session import get_db, get_plugin_db
from app.discord import client as dc_client
from app.discord.config import get_discord_config
from app.discord import store as dc_store
from app.discord.sync_vip import sync_vip_role, VipSyncReport


router = APIRouter()


class DiscordConfigStatus(BaseModel):
    """Public-facing snapshot of the Discord settings."""

    # Public fields (safe to surface)
    client_id:     str
    public_key:    str
    guild_id:      str
    redirect_uri:  str
    # Booleans only -- never the actual secret values.
    has_client_secret: bool
    has_bot_token:     bool
    # Capability flags, derived from the above.
    oauth_ready:       bool
    bot_ready:         bool
    # Hint listing the .env keys still empty (e.g. ['DISCORD_BOT_TOKEN']).
    missing_for_oauth: list[str]
    missing_for_bot:   list[str]
    # Auto-promotion whitelists: every Discord ID listed here gets a
    # matching panel AppUser (`discord:<id>`) auto-created with the
    # listed role on first Discord login -- bypassing the explicit
    # link-app-user binding.  Read from .env, so editing requires a
    # service restart (Settings -> Discord -> Config tab spells this out).
    admin_user_ids:    list[str] = []
    operator_user_ids: list[str] = []
    viewer_user_ids:   list[str] = []
    # Phase 4 VIP sync: when set, the Settings -> Discord page enables
    # the manual 'Sync VIP' button.  Empty -> sync endpoint 503s.
    vip_role_id:       str = ""
    vip_sync_ready:    bool = False


@router.get(
    "/config",
    response_model=DiscordConfigStatus,
    dependencies=[Depends(require_admin)],
)
def get_config_status() -> DiscordConfigStatus:
    """
    Report which Discord settings are configured on this host.

    NEVER returns the secret values themselves -- only booleans.  Used
    by the upcoming Settings -> Discord page to drive the "what do I
    still need to fill in?" hint banner.
    """
    cfg = get_discord_config()
    # Whitelists live on ServerSettings, not on DiscordConfig (DiscordConfig
    # is the OAuth/bot credential surface).  Parse the CSVs here so the
    # admin UI can show them without re-implementing the split.
    from app.core.config import server_settings as _s
    def _split_ids(raw: str) -> list[str]:
        return [x.strip() for x in (raw or "").split(",") if x.strip()]
    return DiscordConfigStatus(
        client_id     = cfg.client_id,
        public_key    = cfg.public_key,
        guild_id      = cfg.guild_id,
        redirect_uri  = cfg.redirect_uri,
        has_client_secret = bool(cfg.client_secret),
        has_bot_token     = bool(cfg.bot_token),
        oauth_ready       = cfg.has_oauth and cfg.has_redirect,
        bot_ready         = cfg.has_bot,
        missing_for_oauth = cfg.missing_for_oauth(),
        missing_for_bot   = cfg.missing_for_bot(),
        admin_user_ids    = _split_ids(_s.DISCORD_ADMIN_USER_IDS),
        operator_user_ids = _split_ids(_s.DISCORD_OPERATOR_USER_IDS),
        viewer_user_ids   = _split_ids(_s.DISCORD_VIEWER_USER_IDS),
        vip_role_id       = (_s.DISCORD_VIP_ROLE_ID or "").strip(),
        vip_sync_ready    = bool((_s.DISCORD_VIP_ROLE_ID or "").strip()) and cfg.has_bot,
    )


# ── Discord <-> AppUser linking (admin only) ─────────────────────────────────
#
# An admin can pre-bind a Discord identity to an existing panel
# AppUser.  After the next Discord OAuth login, the callback issues
# a panel JWT for that AppUser and the Discord user gets dropped
# straight into the admin / operator UI.

class _DiscordAccountRead(BaseModel):
    discord_user_id:     str
    discord_username:    Optional[str] = None
    discord_global_name: Optional[str] = None
    discord_avatar:      Optional[str] = None
    eos_id:              Optional[str] = None
    app_user_id:         Optional[int] = None
    app_user_username:   Optional[str] = None
    app_user_role:       Optional[str] = None
    linked_at:           Optional[str] = None
    last_sync_at:        Optional[str] = None


class _LinkAppUserRequest(BaseModel):
    """Body for :func:`link_app_user`."""

    app_user_id:       Optional[int] = None
    app_user_username: Optional[str] = None


async def _resolve_app_user(
    db: AsyncSession,
    *,
    app_user_id: Optional[int],
    app_user_username: Optional[str],
) -> AppUser:
    """Load an AppUser by id OR username; raises 404 when neither matches."""
    if app_user_id is not None:
        u = await db.scalar(select(AppUser).where(AppUser.id == app_user_id))
        if u: return u
    if app_user_username:
        u = await db.scalar(
            select(AppUser).where(AppUser.username == app_user_username.lower().strip())
        )
        if u: return u
    raise HTTPException(
        status_code=404,
        detail="AppUser not found (pass app_user_id or app_user_username).",
    )


def _row_with_app_user(row: dict, app_user: Optional[AppUser]) -> _DiscordAccountRead:
    return _DiscordAccountRead(
        discord_user_id     = row["discord_user_id"],
        discord_username    = row.get("discord_username"),
        discord_global_name = row.get("discord_global_name"),
        discord_avatar      = row.get("discord_avatar"),
        eos_id              = row.get("eos_id"),
        app_user_id         = row.get("app_user_id"),
        app_user_username   = app_user.username if app_user else None,
        app_user_role       = app_user.role     if app_user else None,
        linked_at           = row.get("linked_at"),
        last_sync_at        = row.get("last_sync_at"),
    )


@router.post(
    "/link-app-user/{discord_user_id}",
    response_model=_DiscordAccountRead,
    dependencies=[Depends(require_admin)],
)
async def link_app_user(
    discord_user_id: str,
    body: _LinkAppUserRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Bind a Discord identity to an existing panel AppUser.

    The Discord identity must already exist (i.e. the user logged in
    with Discord at least once so the OAuth callback created the
    discord_account row).  Admin bind/unbind only -- end users can't
    self-elevate.
    """
    existing = await dc_store.get_by_discord_id(db, discord_user_id)
    if not existing:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No Discord account known for ID {discord_user_id}.  "
                "Ask the user to Sign in with Discord at least once first."
            ),
        )
    user = await _resolve_app_user(
        db,
        app_user_id=body.app_user_id,
        app_user_username=body.app_user_username,
    )
    # The UNIQUE index on app_user_id rejects an attempt to bind the
    # same AppUser to two different Discord identities.
    other = await dc_store.get_by_app_user_id(db, user.id)
    if other and other["discord_user_id"] != discord_user_id:
        raise HTTPException(
            status_code=409,
            detail=(
                f"AppUser {user.username} is already linked to Discord ID "
                f"{other['discord_user_id']}.  Unlink that one first."
            ),
        )
    fresh = await dc_store.set_app_user_link(
        db, discord_user_id=discord_user_id, app_user_id=user.id,
    )
    return _row_with_app_user(fresh, user)


@router.delete(
    "/link-app-user/{discord_user_id}",
    response_model=_DiscordAccountRead,
    dependencies=[Depends(require_admin)],
)
async def unlink_app_user(
    discord_user_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Remove the AppUser link from a Discord account."""
    existing = await dc_store.get_by_discord_id(db, discord_user_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Discord account not found.")
    fresh = await dc_store.set_app_user_link(
        db, discord_user_id=discord_user_id, app_user_id=None,
    )
    return _row_with_app_user(fresh, None)


# ── Discord <-> ARK player linking (admin only) ──────────────────────────────
#
# Per the operator: "il link giocatore-discord lo farei io a mano dal pannello
# admin, cosi ho sicurezza del link tra i due".  Self-link is intentionally
# NOT exposed; only an admin can bind a Discord identity to an EOS player.
# The 1:1 enforcement is the existing UNIQUE index on
# arkmaniagest_discord_accounts.eos_id.

class _LinkEosRequest(BaseModel):
    """Body for :func:`link_eos_player`."""
    eos_id: str


class _PlayerSearchResult(BaseModel):
    """Single hit returned by :func:`search_players`."""
    eos_id:     str
    name:       Optional[str] = None
    tribe_name: Optional[str] = None


@router.get(
    "/players/search",
    response_model=list[_PlayerSearchResult],
    dependencies=[Depends(require_admin)],
)
async def search_players(
    q: str,
    limit: int = 25,
    plugin_db: AsyncSession = Depends(get_plugin_db),
):
    """
    Autocomplete-friendly search across the ARK Players table.

    Used by the admin "Link player" modal to resolve a partial name / EOS
    suffix / tribe substring into a concrete player row.  Matches against
    Players.Giocatore, Players.EOS_Id and ARKM_player_tribes.tribe_name
    (so 'Tritolo Tribe' resolves the tribe leader's row even when the
    operator only knows the tribe name).

    Capped at ``limit`` rows (default 25) to keep dropdowns snappy --
    operators are expected to refine the query, not paginate this.
    """
    q_clean = (q or "").strip()
    if len(q_clean) < 2:
        return []
    like = f"%{q_clean}%"
    limit = max(1, min(int(limit), 100))

    # Tribe-name match: collect EOS IDs whose tribe matches, then fold
    # them into the main Players query so a single hit set comes back.
    tribe_hits = await plugin_db.execute(
        text(
            "SELECT DISTINCT eos_id, tribe_name "
            "FROM ARKM_player_tribes "
            "WHERE tribe_name LIKE :q "
            "ORDER BY last_login DESC "
            "LIMIT :lim"
        ),
        {"q": like, "lim": limit * 4},
    )
    tribe_eos_to_name: dict[str, str] = {}
    for row in tribe_hits.fetchall():
        if row[0] and row[0] not in tribe_eos_to_name:
            tribe_eos_to_name[row[0]] = (row[1] or "").strip()

    # Main Players query: name OR EOS_Id OR EOS_Id IN tribe_eos
    if tribe_eos_to_name:
        eos_ids = list(tribe_eos_to_name.keys())
        placeholders = ",".join(f":e{i}" for i in range(len(eos_ids)))
        params = {f"e{i}": eid for i, eid in enumerate(eos_ids)}
        params["q"] = like
        params["lim"] = limit
        sql = (
            "SELECT EOS_Id, Giocatore FROM Players "
            f"WHERE Giocatore LIKE :q OR EOS_Id LIKE :q OR EOS_Id IN ({placeholders}) "
            "ORDER BY (CASE WHEN Giocatore LIKE :q THEN 0 ELSE 1 END), Id DESC "
            "LIMIT :lim"
        )
    else:
        sql = (
            "SELECT EOS_Id, Giocatore FROM Players "
            "WHERE Giocatore LIKE :q OR EOS_Id LIKE :q "
            "ORDER BY (CASE WHEN Giocatore LIKE :q THEN 0 ELSE 1 END), Id DESC "
            "LIMIT :lim"
        )
        params = {"q": like, "lim": limit}

    rows = (await plugin_db.execute(text(sql), params)).fetchall()

    # Backfill tribe_name for rows we hit via name/EOS but the operator
    # might still want to disambiguate by tribe.  One quick lookup per
    # batch keeps this O(1) per result row.
    seen_eos = [r[0] for r in rows]
    if seen_eos:
        ph = ",".join(f":t{i}" for i in range(len(seen_eos)))
        tparams = {f"t{i}": eid for i, eid in enumerate(seen_eos)}
        tribe_rows = (await plugin_db.execute(
            text(
                f"SELECT eos_id, tribe_name FROM ARKM_player_tribes "
                f"WHERE eos_id IN ({ph}) ORDER BY last_login DESC"
            ),
            tparams,
        )).fetchall()
        for tr in tribe_rows:
            tribe_eos_to_name.setdefault(tr[0], (tr[1] or "").strip())

    return [
        _PlayerSearchResult(
            eos_id     = r[0],
            name       = r[1],
            tribe_name = tribe_eos_to_name.get(r[0]) or None,
        )
        for r in rows
    ]


@router.post(
    "/link-eos/{discord_user_id}",
    response_model=_DiscordAccountRead,
    dependencies=[Depends(require_admin)],
)
async def link_eos_player(
    discord_user_id: str,
    body: _LinkEosRequest,
    db: AsyncSession = Depends(get_db),
    plugin_db: AsyncSession = Depends(get_plugin_db),
):
    """
    Bind a Discord identity to an existing ARK player by EOS ID.

    The Discord row must already exist (Discord OAuth login at least once),
    and the EOS ID must resolve to a row in the plugin's ``Players`` table
    -- we refuse the link if either is missing so the admin doesn't end up
    with a dangling pointer.

    The 1:1 invariant (one Discord <-> one EOS) is enforced by the UNIQUE
    index on ``eos_id``: an attempt to bind two Discord identities to the
    same player raises an IntegrityError that we surface as 409.
    """
    # 1. Discord side must exist
    existing = await dc_store.get_by_discord_id(db, discord_user_id)
    if not existing:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No Discord account known for ID {discord_user_id}.  "
                "Ask the user to Sign in with Discord at least once first."
            ),
        )

    # 2. EOS side must exist (otherwise the link is meaningless)
    eos_id = (body.eos_id or "").strip()
    if not eos_id:
        raise HTTPException(status_code=422, detail="eos_id is required.")
    player_row = (await plugin_db.execute(
        text("SELECT EOS_Id, Giocatore FROM Players WHERE EOS_Id = :e LIMIT 1"),
        {"e": eos_id},
    )).fetchone()
    if not player_row:
        raise HTTPException(
            status_code=404,
            detail=f"No ARK player found with EOS_Id={eos_id}.",
        )

    # 3. Reject if that EOS is already bound to ANOTHER Discord identity.
    other = await dc_store.get_by_eos_id(db, eos_id)
    if other and other["discord_user_id"] != discord_user_id:
        raise HTTPException(
            status_code=409,
            detail=(
                f"EOS {eos_id} is already linked to Discord ID "
                f"{other['discord_user_id']}.  Unlink that one first."
            ),
        )

    fresh = await dc_store.set_link(
        db, discord_user_id=discord_user_id, eos_id=eos_id,
    )
    # Re-fetch the AppUser link side so the response stays a complete row.
    app_user = None
    if fresh.get("app_user_id"):
        app_user = await db.scalar(
            select(AppUser).where(AppUser.id == fresh["app_user_id"])
        )
    return _row_with_app_user(fresh, app_user)


@router.delete(
    "/link-eos/{discord_user_id}",
    response_model=_DiscordAccountRead,
    dependencies=[Depends(require_admin)],
)
async def unlink_eos_player(
    discord_user_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Sever the Discord <-> EOS link (does NOT touch the AppUser link)."""
    existing = await dc_store.get_by_discord_id(db, discord_user_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Discord account not found.")
    fresh = await dc_store.set_link(
        db, discord_user_id=discord_user_id, eos_id=None,
    )
    app_user = None
    if fresh.get("app_user_id"):
        app_user = await db.scalar(
            select(AppUser).where(AppUser.id == fresh["app_user_id"])
        )
    return _row_with_app_user(fresh, app_user)


@router.get(
    "/accounts",
    response_model=list[_DiscordAccountRead],
    dependencies=[Depends(require_admin)],
)
async def list_discord_accounts(db: AsyncSession = Depends(get_db)):
    """
    List every known Discord identity + its current player / AppUser link.

    Used by the (Phase 3+) admin Discord-management page to show 'who
    has signed in', 'who is linked to whom', 'who needs linking'.
    """
    res = await db.execute(
        text(
            "SELECT d.*, u.username AS _u_name, u.role AS _u_role "
            "FROM arkmaniagest_discord_accounts d "
            "LEFT JOIN arkmaniagest_users u ON u.id = d.app_user_id "
            "ORDER BY d.linked_at DESC, d.created_at DESC"
        )
    )
    out: list[_DiscordAccountRead] = []
    for row in res.mappings().fetchall():
        m = dict(row)
        u_name = m.pop("_u_name", None)
        u_role = m.pop("_u_role", None)
        # Reuse the row->dict normaliser for date / token cleanup.
        # We use a tiny stub so we don't have to re-decrypt -- accounts
        # listing is admin-only metadata, no tokens involved.
        # Format dates inline:
        for f in ("token_expires_at", "linked_at", "last_sync_at",
                  "created_at", "updated_at"):
            if m.get(f) and hasattr(m[f], "isoformat"):
                m[f] = m[f].isoformat()
        m.pop("access_token_enc",  None)
        m.pop("refresh_token_enc", None)
        out.append(_DiscordAccountRead(
            discord_user_id     = m["discord_user_id"],
            discord_username    = m.get("discord_username"),
            discord_global_name = m.get("discord_global_name"),
            discord_avatar      = m.get("discord_avatar"),
            eos_id              = m.get("eos_id"),
            app_user_id         = m.get("app_user_id"),
            app_user_username   = u_name,
            app_user_role       = u_role,
            linked_at           = m.get("linked_at"),
            last_sync_at        = m.get("last_sync_at"),
        ))
    return out


# ── Discord bot interaction (admin only) ─────────────────────────────────────
#
# The bot must be invited to the guild AND its role must sit ABOVE the
# target's highest role for moderation calls.  Discord returns 50013
# ("Missing Permissions") otherwise; we surface the message verbatim so
# the operator can act on the actual fix instead of a generic 500.

def _require_bot_ready() -> tuple[str, str]:
    """
    Return (bot_token, guild_id) once the bot side is fully configured.

    Raises 503 with a list of the missing .env keys so the admin UI can
    point the operator at the exact fix.
    """
    cfg = get_discord_config()
    if not cfg.has_bot:
        missing = ", ".join(cfg.missing_for_bot()) or "DISCORD_BOT_TOKEN, DISCORD_GUILD_ID"
        raise HTTPException(
            status_code=503,
            detail=f"Discord bot not configured. Missing env keys: {missing}",
        )
    return cfg.bot_token, cfg.guild_id


def _wrap_discord_call(coro_factory):
    """
    Run a Discord API helper and translate :class:`DiscordAPIError` into
    a FastAPI HTTPException carrying Discord's own message.

    We re-raise 401/403/404 as-is (semantically meaningful for the UI) and
    flatten everything else to 502 ("upstream error") so the panel doesn't
    falsely advertise a 500 on the panel itself.
    """
    async def _runner():
        try:
            return await coro_factory()
        except dc_client.DiscordAPIError as exc:
            status = exc.status if exc.status in (400, 401, 403, 404, 409, 429) else 502
            raise HTTPException(status_code=status, detail=str(exc)) from None
    return _runner


# ── Pydantic shapes ──────────────────────────────────────────────────────────

class _GuildInfo(BaseModel):
    id:                   str
    name:                 str
    icon:                 Optional[str] = None
    owner_id:             Optional[str] = None
    approximate_member_count:  Optional[int] = None
    approximate_presence_count: Optional[int] = None


class _GuildRole(BaseModel):
    id:        str
    name:      str
    color:     int = 0
    position:  int = 0
    hoist:     bool = False
    managed:   bool = False
    mentionable: bool = False


class _GuildMember(BaseModel):
    user_id:      str
    username:     Optional[str] = None
    global_name:  Optional[str] = None
    avatar:       Optional[str] = None
    nick:         Optional[str] = None
    roles:        list[str] = []
    joined_at:    Optional[str] = None


class _BanRequest(BaseModel):
    reason:                 Optional[str] = None
    delete_message_seconds: int = 0


class _DmRequest(BaseModel):
    content: str


# ── Guild snapshot ───────────────────────────────────────────────────────────

@router.get(
    "/guild/info",
    response_model=_GuildInfo,
    dependencies=[Depends(require_admin)],
)
async def get_guild_info():
    """Top-of-page banner data for the Settings -> Discord 'Guild' tab."""
    bot_token, guild_id = _require_bot_ready()
    data = await _wrap_discord_call(
        lambda: dc_client.get_guild(bot_token=bot_token, guild_id=guild_id)
    )()
    return _GuildInfo(
        id   = data["id"],
        name = data.get("name") or "",
        icon = data.get("icon"),
        owner_id = data.get("owner_id"),
        approximate_member_count   = data.get("approximate_member_count"),
        approximate_presence_count = data.get("approximate_presence_count"),
    )


@router.get(
    "/guild/roles",
    response_model=list[_GuildRole],
    dependencies=[Depends(require_admin)],
)
async def list_guild_roles_endpoint():
    """List every role in the configured guild, sorted by position desc."""
    bot_token, guild_id = _require_bot_ready()
    data = await _wrap_discord_call(
        lambda: dc_client.list_guild_roles(bot_token=bot_token, guild_id=guild_id)
    )()
    out = [
        _GuildRole(
            id          = r["id"],
            name        = r.get("name") or "",
            color       = int(r.get("color") or 0),
            position    = int(r.get("position") or 0),
            hoist       = bool(r.get("hoist") or False),
            managed     = bool(r.get("managed") or False),
            mentionable = bool(r.get("mentionable") or False),
        )
        for r in (data or [])
    ]
    # Highest position first -- matches Discord's own role list ordering.
    out.sort(key=lambda r: r.position, reverse=True)
    return out


@router.get(
    "/guild/members",
    response_model=list[_GuildMember],
    dependencies=[Depends(require_admin)],
)
async def list_guild_members_endpoint(
    limit: int = 100,
    after: Optional[str] = None,
):
    """
    Paginated guild member list.  The admin UI walks pages by passing
    ``after=<last_user_id>`` until the response is shorter than ``limit``.

    Discord caps ``limit`` at 1000 per call.  Requires the GUILD_MEMBERS
    privileged intent enabled on the application; absence of the intent
    surfaces here as a 403 from Discord (we forward the message verbatim).
    """
    bot_token, guild_id = _require_bot_ready()
    data = await _wrap_discord_call(
        lambda: dc_client.list_guild_members(
            bot_token=bot_token, guild_id=guild_id,
            limit=limit, after=after,
        )
    )()
    out: list[_GuildMember] = []
    for m in (data or []):
        u = m.get("user") or {}
        out.append(_GuildMember(
            user_id     = u.get("id") or "",
            username    = u.get("username"),
            global_name = u.get("global_name"),
            avatar      = u.get("avatar"),
            nick        = m.get("nick"),
            roles       = list(m.get("roles") or []),
            joined_at   = m.get("joined_at"),
        ))
    return out


# ── Member moderation ────────────────────────────────────────────────────────

@router.put(
    "/guild/members/{user_id}/roles/{role_id}",
    status_code=204,
    dependencies=[Depends(require_admin)],
)
async def assign_role_endpoint(user_id: str, role_id: str):
    """Add a role to a guild member (admin manual override)."""
    bot_token, guild_id = _require_bot_ready()
    await _wrap_discord_call(
        lambda: dc_client.add_guild_member_role(
            bot_token=bot_token, guild_id=guild_id,
            user_id=user_id, role_id=role_id,
        )
    )()
    return None


@router.delete(
    "/guild/members/{user_id}/roles/{role_id}",
    status_code=204,
    dependencies=[Depends(require_admin)],
)
async def remove_role_endpoint(user_id: str, role_id: str):
    """Remove a role from a guild member."""
    bot_token, guild_id = _require_bot_ready()
    await _wrap_discord_call(
        lambda: dc_client.remove_guild_member_role(
            bot_token=bot_token, guild_id=guild_id,
            user_id=user_id, role_id=role_id,
        )
    )()
    return None


@router.delete(
    "/guild/members/{user_id}",
    status_code=204,
    dependencies=[Depends(require_admin)],
)
async def kick_member_endpoint(user_id: str):
    """Kick a member (they can re-join via an invite)."""
    bot_token, guild_id = _require_bot_ready()
    await _wrap_discord_call(
        lambda: dc_client.remove_guild_member(
            bot_token=bot_token, guild_id=guild_id, user_id=user_id,
        )
    )()
    return None


@router.put(
    "/guild/bans/{user_id}",
    status_code=204,
    dependencies=[Depends(require_admin)],
)
async def ban_member_endpoint(user_id: str, body: _BanRequest):
    """Ban a member (audit-log reason via X-Audit-Log-Reason)."""
    bot_token, guild_id = _require_bot_ready()
    await _wrap_discord_call(
        lambda: dc_client.create_guild_ban(
            bot_token=bot_token, guild_id=guild_id, user_id=user_id,
            reason=body.reason,
            delete_message_seconds=body.delete_message_seconds,
        )
    )()
    return None


@router.delete(
    "/guild/bans/{user_id}",
    status_code=204,
    dependencies=[Depends(require_admin)],
)
async def unban_member_endpoint(user_id: str):
    """Lift an existing ban so the user can rejoin via invite."""
    bot_token, guild_id = _require_bot_ready()
    await _wrap_discord_call(
        lambda: dc_client.remove_guild_ban(
            bot_token=bot_token, guild_id=guild_id, user_id=user_id,
        )
    )()
    return None


# ── DM ───────────────────────────────────────────────────────────────────────

# ── VIP sync (Phase 4) ───────────────────────────────────────────────────────

@router.post(
    "/sync-vip",
    response_model=VipSyncReport,
    dependencies=[Depends(require_admin)],
)
async def sync_vip_endpoint(
    db:        AsyncSession = Depends(get_db),
    plugin_db: AsyncSession = Depends(get_plugin_db),
):
    """
    Reconcile the Discord VIP role with the panel/plugin DB (manual run).

    Direction is fixed: ARK plugin DB is authoritative.  The endpoint
    walks every linked discord_account, computes 'should be VIP' from
    the Players row (permanent OR active timed entry for the 'VIP'
    permission group), and pushes the diff into Discord by adding /
    removing the role.  Discord-side members who carry the role but
    are NOT in our linked-accounts set are observed only -- never
    stripped, the operator gets the list back to act on manually.

    Requires both bot credentials AND a configured DISCORD_VIP_ROLE_ID.
    A 503 with the missing key list is returned otherwise so the admin
    UI can render the actual fix.
    """
    bot_token, guild_id = _require_bot_ready()
    vip_role_id = (server_settings.DISCORD_VIP_ROLE_ID or "").strip()
    if not vip_role_id:
        raise HTTPException(
            status_code=503,
            detail=(
                "Discord VIP sync not configured.  Set DISCORD_VIP_ROLE_ID "
                "in .env (the Discord snowflake of the VIP role) and "
                "restart the service."
            ),
        )
    return await sync_vip_role(
        db=db, plugin_db=plugin_db,
        bot_token=bot_token, guild_id=guild_id, vip_role_id=vip_role_id,
    )


@router.post(
    "/dm/{user_id}",
    dependencies=[Depends(require_admin)],
)
async def dm_user_endpoint(user_id: str, body: _DmRequest):
    """
    Open a DM channel with a user and post a message.

    Discord caches DM channels per recipient -- repeated calls hit the
    same channel id.  Content is capped at the Discord 2000-char hard
    limit (we trim instead of erroring; the operator's intent is clearly
    to deliver the message).
    """
    bot_token, _ = _require_bot_ready()
    content = (body.content or "").strip()
    if not content:
        raise HTTPException(status_code=422, detail="content is required.")
    content = content[:2000]
    channel = await _wrap_discord_call(
        lambda: dc_client.create_dm_channel(bot_token=bot_token, recipient_id=user_id)
    )()
    msg = await _wrap_discord_call(
        lambda: dc_client.send_message(
            bot_token=bot_token, channel_id=channel["id"], content=content,
        )
    )()
    return {
        "channel_id": channel["id"],
        "message_id": msg.get("id"),
    }
