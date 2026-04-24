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
from app.db.models.app import AppUser
from app.db.session import get_db, get_plugin_db
from app.discord.config import get_discord_config
from app.discord import store as dc_store


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
