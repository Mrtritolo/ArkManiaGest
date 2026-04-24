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
from app.db.session import get_db
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
