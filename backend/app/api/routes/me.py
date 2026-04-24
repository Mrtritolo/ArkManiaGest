"""
api/routes/me.py — Player-facing dashboard endpoints (Phase 6).

Exposed under the `/me/*` prefix.  Authenticated by the Discord
session cookie (``disc_session``) issued by the Phase-2 OAuth
callback -- NOT by the panel JWT, because the typical caller is
a player who has logged in via Discord but has no AppUser binding.

The Discord identity must already be linked to an EOS player
(via the admin Settings -> Discord -> Accounts -> 'Link player'
flow).  An unlinked Discord caller gets 403 + a hint to ask an
admin for the binding.

Endpoints:
  GET /me/dashboard  -- combined character + shop + decay snapshot
                        for the current player.

Subsequent commits add `GET /me/inventory` etc. as the dashboard
grows.
"""

from __future__ import annotations

from typing import Optional

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.auth_discord import (
    _SESSION_COOKIE, _AUD_SESSION, _verify_jwt,
)
from app.db.session import get_db, get_plugin_db
from app.discord import store as dc_store


router = APIRouter()


# ── Auth dependency ──────────────────────────────────────────────────────────

class _PlayerSession(BaseModel):
    """The resolved current-player context inside a /me handler."""

    discord_user_id: str
    eos_id:          str
    discord_username:    Optional[str] = None
    discord_global_name: Optional[str] = None
    discord_avatar:      Optional[str] = None


async def get_current_player(
    disc_session: Optional[str] = Cookie(default=None, alias=_SESSION_COOKIE),
    db:           AsyncSession  = Depends(get_db),
) -> _PlayerSession:
    """
    Resolve the Discord-session cookie into a (discord_user_id, eos_id)
    pair for the current request.  Used as a FastAPI dependency on every
    /me/* endpoint -- a missing/expired cookie returns 401, a Discord
    identity without a linked EOS returns 403.
    """
    if not disc_session:
        raise HTTPException(status_code=401, detail="No Discord session.")
    try:
        payload = _verify_jwt(disc_session, audience=_AUD_SESSION)
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        raise HTTPException(status_code=401, detail="Discord session expired.") from None
    discord_user_id = payload.get("discord_user_id")
    if not discord_user_id:
        raise HTTPException(status_code=401, detail="Malformed Discord session.")

    row = await dc_store.get_by_discord_id(db, discord_user_id)
    if not row:
        # Cookie referenced a row that's gone -- treat as logged out.
        raise HTTPException(status_code=401, detail="Discord session orphaned.")
    eos_id = row.get("eos_id")
    if not eos_id:
        raise HTTPException(
            status_code=403,
            detail=(
                "Your Discord account is not linked to an ARK player yet.  "
                "Ask a server admin to link your account from the panel "
                "(Settings -> Discord -> Accounts -> Link player)."
            ),
        )
    return _PlayerSession(
        discord_user_id     = discord_user_id,
        eos_id              = eos_id,
        discord_username    = row.get("discord_username"),
        discord_global_name = row.get("discord_global_name"),
        discord_avatar      = row.get("discord_avatar"),
    )


# ── Response shapes ──────────────────────────────────────────────────────────

class _CharacterCard(BaseModel):
    eos_id:      str
    name:        Optional[str] = None
    tribe_id:    Optional[int] = None
    tribe_name:  Optional[str] = None
    last_login:  Optional[str] = None
    permission_groups:        list[str] = []
    timed_permission_groups:  list[dict] = []   # {group, expires_at_iso, expired}


class _ShopCard(BaseModel):
    points:       int = 0
    total_spent:  int = 0
    # The Kits column stores plugin-internal text.  We surface it raw so the
    # UI can decide whether to parse/display it; future commits can add a
    # structured parser when the plugin's format is documented.
    kits_raw:     Optional[str] = None


class _DecayCard(BaseModel):
    has_tribe:           bool
    tribe_id:            Optional[int] = None
    tribe_name:          Optional[str] = None
    expire_at:           Optional[str] = None       # ISO 8601
    hours_left:          Optional[int] = None        # negative when expired
    status:              Optional[str] = None        # 'safe' | 'expiring' | 'expired'
    scheduled_for_purge: bool = False
    last_refresh_at:     Optional[str] = None
    last_refresh_name:   Optional[str] = None
    last_refresh_days:   Optional[int] = None


class _DiscordCard(BaseModel):
    discord_user_id:     str
    discord_username:    Optional[str] = None
    discord_global_name: Optional[str] = None
    discord_avatar:      Optional[str] = None


class _DashboardResponse(BaseModel):
    discord:   _DiscordCard
    character: _CharacterCard
    shop:      _ShopCard
    decay:     _DecayCard


# ── Helpers ──────────────────────────────────────────────────────────────────

def _split_perm_groups(raw: Optional[str]) -> list[str]:
    """Split a CSV permission-groups column, dropping empties."""
    if not raw:
        return []
    return [g.strip() for g in raw.split(",") if g.strip()]


def _parse_timed_perm_groups(raw: Optional[str]) -> list[dict]:
    """
    Parse the ``TimedPermissionGroups`` column.

    Format (per the existing players.py parser):
        ``flag;timestamp;groupname,flag;timestamp;groupname,...``

    Returns ``[{group, expires_at_iso, expired}, ...]``.
    """
    if not raw:
        return []
    import datetime as _dt
    out: list[dict] = []
    now = int(_dt.datetime.now().timestamp())
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split(";")
        if len(parts) < 3:
            continue
        try:
            ts = int(parts[1])
        except (ValueError, TypeError):
            ts = 0
        group = parts[2].strip()
        if not group:
            continue
        out.append({
            "group":          group,
            "expires_at_iso": _dt.datetime.fromtimestamp(ts).isoformat() if ts else None,
            "expired":        bool(ts > 0 and ts < now),
        })
    return out


def _decay_status_label(hours_left: Optional[int]) -> Optional[str]:
    """Mirror the existing /arkmania/decay status thresholds."""
    if hours_left is None:
        return None
    if hours_left < 0:
        return "expired"
    if hours_left < 72:
        return "expiring"
    return "safe"


# ── Endpoint ─────────────────────────────────────────────────────────────────

@router.get("/dashboard", response_model=_DashboardResponse)
async def get_dashboard(
    player:    _PlayerSession = Depends(get_current_player),
    plugin_db: AsyncSession   = Depends(get_plugin_db),
):
    """
    Return a combined character + shop + decay snapshot for the player
    bound to the current Discord session.

    The single combined endpoint exists so the dashboard can render in
    one round-trip on first paint; the individual /me/character,
    /me/shop, /me/decay endpoints will be added later for incremental
    refresh use cases (e.g. shop tab updating after a purchase).
    """
    eos = player.eos_id

    # 1. Players row (core character + permission groups)
    p_row = (await plugin_db.execute(
        text(
            "SELECT EOS_Id, Giocatore, PermissionGroups, TimedPermissionGroups "
            "FROM Players WHERE EOS_Id = :e LIMIT 1"
        ),
        {"e": eos},
    )).mappings().fetchone()
    if not p_row:
        # Linked EOS no longer exists in the live plugin DB (e.g. wiped
        # save).  Surface as 404 so the SPA can show a friendly notice
        # instead of a generic error.
        raise HTTPException(
            status_code=404,
            detail="Your linked ARK character is not present on this server.",
        )

    # 2. Tribe (latest entry by last_login)
    t_row = (await plugin_db.execute(
        text(
            "SELECT eos_id, targeting_team, tribe_name, last_login "
            "FROM ARKM_player_tribes "
            "WHERE eos_id = :e "
            "ORDER BY last_login DESC LIMIT 1"
        ),
        {"e": eos},
    )).mappings().fetchone()

    # 3. Shop row
    s_row = (await plugin_db.execute(
        text(
            "SELECT EosId, Points, TotalSpent, Kits "
            "FROM ArkShopPlayers WHERE EosId = :e LIMIT 1"
        ),
        {"e": eos},
    )).mappings().fetchone()

    # 4. Decay row (only when we resolved a tribe)
    d_row = None
    pending_row = None
    if t_row and t_row.get("targeting_team") is not None:
        d_row = (await plugin_db.execute(
            text(
                "SELECT targeting_team, tribe_name, expire_time, "
                "       last_refresh_eos, last_refresh_name, "
                "       last_refresh_group, last_refresh_days, "
                "       last_refresh_time, "
                "       TIMESTAMPDIFF(HOUR, NOW(), expire_time) AS hours_left "
                "FROM ARKM_tribe_decay WHERE targeting_team = :t LIMIT 1"
            ),
            {"t": int(t_row["targeting_team"])},
        )).mappings().fetchone()
        pending_row = (await plugin_db.execute(
            text(
                "SELECT 1 FROM ARKM_decay_pending "
                "WHERE targeting_team = :t LIMIT 1"
            ),
            {"t": int(t_row["targeting_team"])},
        )).fetchone()

    # ── Assemble response ────────────────────────────────────────────────

    discord_card = _DiscordCard(
        discord_user_id     = player.discord_user_id,
        discord_username    = player.discord_username,
        discord_global_name = player.discord_global_name,
        discord_avatar      = player.discord_avatar,
    )

    character_card = _CharacterCard(
        eos_id     = p_row["EOS_Id"],
        name       = p_row.get("Giocatore"),
        tribe_id   = int(t_row["targeting_team"]) if t_row and t_row.get("targeting_team") is not None else None,
        tribe_name = (t_row.get("tribe_name") if t_row else None) or None,
        last_login = (t_row["last_login"].isoformat()
                      if t_row and t_row.get("last_login") and hasattr(t_row["last_login"], "isoformat")
                      else None),
        permission_groups       = _split_perm_groups(p_row.get("PermissionGroups")),
        timed_permission_groups = _parse_timed_perm_groups(p_row.get("TimedPermissionGroups")),
    )

    shop_card = _ShopCard(
        points      = int((s_row.get("Points") if s_row else 0) or 0),
        total_spent = int((s_row.get("TotalSpent") if s_row else 0) or 0),
        kits_raw    = s_row.get("Kits") if s_row else None,
    )

    decay_card: _DecayCard
    if d_row:
        hours_left = (
            int(d_row["hours_left"])
            if d_row.get("hours_left") is not None
            else None
        )
        decay_card = _DecayCard(
            has_tribe           = True,
            tribe_id            = int(d_row["targeting_team"]),
            tribe_name          = d_row.get("tribe_name") or character_card.tribe_name,
            expire_at           = (d_row["expire_time"].isoformat()
                                   if d_row.get("expire_time") and hasattr(d_row["expire_time"], "isoformat")
                                   else None),
            hours_left          = hours_left,
            status              = _decay_status_label(hours_left),
            scheduled_for_purge = bool(pending_row),
            last_refresh_at     = (d_row["last_refresh_time"].isoformat()
                                   if d_row.get("last_refresh_time") and hasattr(d_row["last_refresh_time"], "isoformat")
                                   else None),
            last_refresh_name   = d_row.get("last_refresh_name"),
            last_refresh_days   = (int(d_row["last_refresh_days"])
                                   if d_row.get("last_refresh_days") is not None
                                   else None),
        )
    else:
        decay_card = _DecayCard(has_tribe=False)

    return _DashboardResponse(
        discord   = discord_card,
        character = character_card,
        shop      = shop_card,
        decay     = decay_card,
    )
