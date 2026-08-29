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
  GET /me/dashboard        -- combined character + shop + decay snapshot
                              for the current player.
  DELETE /me/homes/{id}       -- delete one of the caller's own saved
                              teleport homes (ARKM-Teleport).
  GET  /me/requests           -- status of the caller's self-service
                              requests (kick / rename).
  POST /me/requests/kick      -- queue a kick of the caller's own
                              character (processed by ARKM-Login).
  POST /me/requests/rename    -- queue a character rename (validated and
                              applied by ARKM-Login).
  GET    /me/privacy/export   -- GDPR data-portability export (Art. 20).
  DELETE /me/privacy/account  -- GDPR erasure of the Discord link (Art. 17).

Subsequent commits add `GET /me/inventory` etc. as the dashboard
grows.
"""

from __future__ import annotations

from typing import Optional

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.routes.auth_discord import (
    _SESSION_COOKIE, _AUD_SESSION, _verify_jwt,
)
from app.core.audit import audit_event
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


async def get_current_discord_account(
    disc_session: Optional[str] = Cookie(default=None, alias=_SESSION_COOKIE),
    db:           AsyncSession  = Depends(get_db),
) -> dict:
    """
    Resolve the Discord-session cookie into the full discord_accounts
    row.  Unlike :func:`get_current_player` this does NOT require a
    linked EOS player — GDPR rights (export / erasure) must be
    exercisable by any authenticated Discord identity, linked or not.
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
        raise HTTPException(status_code=401, detail="Discord session orphaned.")
    return row


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


class _PresenceCard(BaseModel):
    """Real-time online status (Phase 7)."""
    online_now:        bool = False
    server_key:        Optional[str] = None
    server_name:       Optional[str] = None
    map_name:          Optional[str] = None
    login_time_iso:    Optional[str] = None
    duration_minutes:  Optional[int] = None


class _ServerPulseCard(BaseModel):
    """Cluster-wide context the player sees in the dashboard header."""
    servers_online:        int = 0
    servers_total:         int = 0
    players_online_total:  int = 0


class _LeaderboardScoreRow(BaseModel):
    """One server-type ranking entry for this player."""
    server_type:        Optional[str] = None
    rank:               Optional[int] = None
    total_players:      Optional[int] = None
    total_points:       int = 0
    kills_wild:         int = 0
    kills_enemy_dino:   int = 0
    kills_player:       int = 0
    tames:              int = 0
    crafts:             int = 0
    structs_destroyed:  int = 0
    deaths:             int = 0
    last_event_iso:     Optional[str] = None


class _LeaderboardCard(BaseModel):
    has_scores: bool = False
    scores:     list[_LeaderboardScoreRow] = []


class _TribeMember(BaseModel):
    eos_id:           str
    name:             Optional[str] = None
    is_self:          bool = False
    online_now:       bool = False
    last_login_iso:   Optional[str] = None


class _TribeCard(BaseModel):
    has_tribe:   bool = False
    tribe_id:    Optional[int] = None
    tribe_name:  Optional[str] = None
    members:     list[_TribeMember] = []


class _RareDinoEvent(BaseModel):
    id:           int
    event_type:   str         # 'KILLED' | 'TAMED' | ...
    dino_name:    Optional[str] = None
    dino_level:   Optional[int] = None
    server_key:   Optional[str] = None
    event_at_iso: Optional[str] = None


class _RareDinoCard(BaseModel):
    kills_30d:  int = 0
    tames_30d:  int = 0
    recent:     list[_RareDinoEvent] = []   # last 10 events


class _HomeEntry(BaseModel):
    """One saved teleport home (ARKM_homes, written by ARKM-Teleport)."""
    id:           int
    name:         str
    server_key:   Optional[str] = None
    server_name:  Optional[str] = None
    map_name:     Optional[str] = None
    x:            Optional[float] = None
    y:            Optional[float] = None
    z:            Optional[float] = None
    created_iso:  Optional[str] = None


class _HomesCard(BaseModel):
    entries: list[_HomeEntry] = []


class _ActivityEvent(BaseModel):
    """Unified item from ARKM_event_log + ARKM_lb_events."""
    source:    str                   # 'event_log' | 'lb_event'
    kind:      str                   # human label (e.g. 'Login', 'Tame', 'Kill Wild')
    points:    Optional[int] = None  # only for lb_event
    detail:    Optional[str] = None  # event_log details OR target_name (lb)
    when_iso:  Optional[str] = None
    server_key:Optional[str] = None


class _ActivityCard(BaseModel):
    items: list[_ActivityEvent] = []


class _DashboardResponse(BaseModel):
    discord:     _DiscordCard
    character:   _CharacterCard
    shop:        _ShopCard
    decay:       _DecayCard
    # Phase 7 enrichments
    presence:    _PresenceCard
    server_pulse:_ServerPulseCard
    leaderboard: _LeaderboardCard
    tribe:       _TribeCard
    rare_dinos:  _RareDinoCard
    activity:    _ActivityCard
    homes:       _HomesCard


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


# Mirror of arkmania_leaderboard.EVENT_TYPES so we don't import the
# whole route module just for a constant.
_LB_EVENT_LABELS: dict[int, str] = {
    1: "Kill Wild",
    2: "Kill Enemy Dino",
    3: "Kill Player",
    4: "Tame",
    5: "Craft",
    6: "Struct Destroyed",
    7: "Death",
}


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

    # 5. Presence (real-time online status of THIS player)
    sess_row = (await plugin_db.execute(
        text(
            "SELECT s.eos_id, s.server_key, s.login_time, "
            "       srv.display_name AS server_name, srv.map_name, "
            "       TIMESTAMPDIFF(MINUTE, s.login_time, NOW()) AS duration_min "
            "FROM ARKM_sessions s "
            "LEFT JOIN ARKM_servers srv ON s.server_key = srv.server_key "
            "WHERE s.eos_id = :e LIMIT 1"
        ),
        {"e": eos},
    )).mappings().fetchone()

    # 6. Server pulse (cluster-wide context)
    pulse_row = (await plugin_db.execute(
        text(
            "SELECT "
            "  (SELECT COUNT(*) FROM ARKM_servers WHERE is_online = 1) AS srv_on, "
            "  (SELECT COUNT(*) FROM ARKM_servers)                    AS srv_tot, "
            "  (SELECT COUNT(*) FROM ARKM_sessions)                   AS players_on"
        ),
    )).fetchone()

    # 7. Leaderboard scores for this player (one row per server_type)
    lb_rows = (await plugin_db.execute(
        text(
            "SELECT server_type, total_points, kills_wild, kills_enemy_dino, "
            "       kills_player, tames, crafts, structs_destroyed, deaths, "
            "       last_event "
            "FROM ARKM_lb_scores WHERE eos_id = :e"
        ),
        {"e": eos},
    )).mappings().fetchall()

    # For each row, compute rank by counting players with strictly higher
    # total_points on the same server_type.  Two queries per server_type;
    # in practice a player has 1-2 server_types (PvE / PvP), so it's
    # bounded.
    lb_score_rows: list[_LeaderboardScoreRow] = []
    for r in lb_rows:
        st = r.get("server_type") or None
        higher = 0
        total  = 0
        if st:
            higher = int((await plugin_db.execute(
                text(
                    "SELECT COUNT(*) FROM ARKM_lb_scores "
                    "WHERE server_type = :st AND total_points > :p"
                ),
                {"st": st, "p": int(r.get("total_points") or 0)},
            )).scalar() or 0)
            total = int((await plugin_db.execute(
                text("SELECT COUNT(*) FROM ARKM_lb_scores WHERE server_type = :st"),
                {"st": st},
            )).scalar() or 0)
        lb_score_rows.append(_LeaderboardScoreRow(
            server_type        = st,
            rank               = (higher + 1) if total else None,
            total_players      = total or None,
            total_points       = int(r.get("total_points") or 0),
            kills_wild         = int(r.get("kills_wild") or 0),
            kills_enemy_dino   = int(r.get("kills_enemy_dino") or 0),
            kills_player       = int(r.get("kills_player") or 0),
            tames              = int(r.get("tames") or 0),
            crafts             = int(r.get("crafts") or 0),
            structs_destroyed  = int(r.get("structs_destroyed") or 0),
            deaths             = int(r.get("deaths") or 0),
            last_event_iso     = (r["last_event"].isoformat()
                                  if r.get("last_event") and hasattr(r["last_event"], "isoformat")
                                  else None),
        ))
    # Highest rank first (lower number = better)
    lb_score_rows.sort(key=lambda x: (x.rank or 99999))

    # 8. Tribe roster (every other linked member)
    tribe_members: list[_TribeMember] = []
    if t_row and t_row.get("targeting_team") is not None:
        tid = int(t_row["targeting_team"])
        # Latest tribes entry per eos_id for this team -- a player may have
        # left/rejoined; we keep the most recent record.
        # ARKM_player_tribes only has: eos_id / targeting_team / tribe_name /
        # last_login.  The roster name comes exclusively from Players.Giocatore
        # via the LEFT JOIN; eos_id prefix is the fallback when Players is
        # missing for a member (rare -- only happens for whoever-tribed-then-
        # was-cleaned-up).
        roster = (await plugin_db.execute(
            text(
                "SELECT pt.eos_id, MAX(pt.last_login) AS last_login, "
                "       NULLIF(p.Giocatore, '') AS name "
                "FROM ARKM_player_tribes pt "
                "LEFT JOIN Players p ON p.EOS_Id = pt.eos_id "
                "WHERE pt.targeting_team = :t "
                "GROUP BY pt.eos_id, p.Giocatore "
                "ORDER BY last_login DESC LIMIT 25"
            ),
            {"t": tid},
        )).mappings().fetchall()
        # Index online sessions for O(1) lookup
        online_set: set[str] = {
            r[0] for r in (await plugin_db.execute(
                text(
                    "SELECT s.eos_id FROM ARKM_sessions s "
                    "JOIN ARKM_player_tribes pt ON pt.eos_id = s.eos_id "
                    "WHERE pt.targeting_team = :t"
                ),
                {"t": tid},
            )).fetchall()
        }
        for m in roster:
            mid = m["eos_id"]
            tribe_members.append(_TribeMember(
                eos_id         = mid,
                name           = m.get("name"),
                is_self        = (mid == eos),
                online_now     = (mid in online_set),
                last_login_iso = (m["last_login"].isoformat()
                                  if m.get("last_login") and hasattr(m["last_login"], "isoformat")
                                  else None),
            ))

    # 9. Rare dinos -- last 30 days, this player as killer/tamer
    rare_30d = (await plugin_db.execute(
        text(
            "SELECT id, event_type, dino_name, dino_level, server_key, event_time "
            "FROM ARKM_rare_spawns "
            "WHERE killer_eos = :e "
            "  AND event_time >= DATE_SUB(NOW(), INTERVAL 30 DAY) "
            "ORDER BY event_time DESC LIMIT 50"
        ),
        {"e": eos},
    )).mappings().fetchall()
    rare_kill_count = sum(1 for r in rare_30d if r.get("event_type") == "KILLED")
    rare_tame_count = sum(1 for r in rare_30d if r.get("event_type") == "TAMED")
    rare_recent: list[_RareDinoEvent] = []
    for r in rare_30d[:10]:   # latest 10 for the timeline
        rare_recent.append(_RareDinoEvent(
            id           = int(r["id"]),
            event_type   = str(r.get("event_type") or ""),
            dino_name    = r.get("dino_name"),
            dino_level   = int(r.get("dino_level")) if r.get("dino_level") is not None else None,
            server_key   = r.get("server_key"),
            event_at_iso = (r["event_time"].isoformat()
                            if r.get("event_time") and hasattr(r["event_time"], "isoformat")
                            else None),
        ))

    # 10. Activity feed = last 10 entries from event_log + lb_events, merged
    el_rows = (await plugin_db.execute(
        text(
            "SELECT 'event_log' AS source, event_type AS kind, NULL AS points, "
            "       details AS detail, event_time AS when_at, server_key "
            "FROM ARKM_event_log WHERE eos_id = :e "
            "ORDER BY event_time DESC LIMIT 10"
        ),
        {"e": eos},
    )).mappings().fetchall()
    lb_event_rows = (await plugin_db.execute(
        text(
            "SELECT 'lb_event' AS source, event_type AS kind_int, points, "
            "       target_name AS detail, created_at AS when_at, server_key "
            "FROM ARKM_lb_events WHERE eos_id = :e "
            "ORDER BY created_at DESC LIMIT 10"
        ),
        {"e": eos},
    )).mappings().fetchall()
    activity_items: list[_ActivityEvent] = []
    for r in el_rows:
        activity_items.append(_ActivityEvent(
            source     = "event_log",
            kind       = str(r.get("kind") or ""),
            points     = None,
            detail     = r.get("detail") or None,
            when_iso   = (r["when_at"].isoformat()
                          if r.get("when_at") and hasattr(r["when_at"], "isoformat")
                          else None),
            server_key = r.get("server_key"),
        ))
    for r in lb_event_rows:
        kid = r.get("kind_int")
        try:
            kid_int = int(kid) if kid is not None else None
        except (ValueError, TypeError):
            kid_int = None
        activity_items.append(_ActivityEvent(
            source     = "lb_event",
            kind       = _LB_EVENT_LABELS.get(kid_int or -1, f"Type {kid_int}") if kid_int is not None else "?",
            points     = int(r["points"]) if r.get("points") is not None else None,
            detail     = r.get("detail") or None,
            when_iso   = (r["when_at"].isoformat()
                          if r.get("when_at") and hasattr(r["when_at"], "isoformat")
                          else None),
            server_key = r.get("server_key"),
        ))
    # Merge sort by timestamp desc; trim to 15 items.
    activity_items.sort(key=lambda x: x.when_iso or "", reverse=True)
    activity_items = activity_items[:15]

    # 11. Saved teleport homes (ARKM-Teleport).  The join on ARKM_servers
    #     is what makes the list readable: server_key is a hash, and the
    #     home limit is per map, so "which map" is the one thing the
    #     player needs to see next to each name.
    home_rows = (await plugin_db.execute(
        text(
            "SELECT h.id, h.name, h.server_key, h.x, h.y, h.z, h.created_at, "
            "       srv.display_name AS server_name, srv.map_name "
            "FROM ARKM_homes h "
            "LEFT JOIN ARKM_servers srv ON h.server_key = srv.server_key "
            "WHERE h.eos_id = :e "
            "ORDER BY srv.map_name IS NULL, srv.map_name, h.name"
        ),
        {"e": eos},
    )).mappings().fetchall()
    home_entries: list[_HomeEntry] = []
    for r in home_rows:
        home_entries.append(_HomeEntry(
            id          = int(r["id"]),
            name        = str(r.get("name") or ""),
            server_key  = r.get("server_key"),
            server_name = r.get("server_name"),
            map_name    = r.get("map_name"),
            x           = float(r["x"]) if r.get("x") is not None else None,
            y           = float(r["y"]) if r.get("y") is not None else None,
            z           = float(r["z"]) if r.get("z") is not None else None,
            created_iso = (r["created_at"].isoformat()
                           if r.get("created_at") and hasattr(r["created_at"], "isoformat")
                           else None),
        ))

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

    presence_card = _PresenceCard(
        online_now       = bool(sess_row),
        server_key       = sess_row.get("server_key") if sess_row else None,
        server_name      = sess_row.get("server_name") if sess_row else None,
        map_name         = sess_row.get("map_name") if sess_row else None,
        login_time_iso   = (sess_row["login_time"].isoformat()
                            if sess_row and sess_row.get("login_time") and hasattr(sess_row["login_time"], "isoformat")
                            else None),
        duration_minutes = (int(sess_row["duration_min"])
                            if sess_row and sess_row.get("duration_min") is not None
                            else None),
    )

    pulse_card = _ServerPulseCard(
        servers_online       = int(pulse_row[0] or 0) if pulse_row else 0,
        servers_total        = int(pulse_row[1] or 0) if pulse_row else 0,
        players_online_total = int(pulse_row[2] or 0) if pulse_row else 0,
    )

    leaderboard_card = _LeaderboardCard(
        has_scores = len(lb_score_rows) > 0,
        scores     = lb_score_rows,
    )

    tribe_card = _TribeCard(
        has_tribe  = bool(t_row and t_row.get("targeting_team") is not None),
        tribe_id   = int(t_row["targeting_team"]) if t_row and t_row.get("targeting_team") is not None else None,
        tribe_name = (t_row.get("tribe_name") if t_row else None) or None,
        members    = tribe_members,
    )

    rare_card = _RareDinoCard(
        kills_30d = rare_kill_count,
        tames_30d = rare_tame_count,
        recent    = rare_recent,
    )

    activity_card = _ActivityCard(items=activity_items)

    return _DashboardResponse(
        discord     = discord_card,
        character   = character_card,
        shop        = shop_card,
        decay       = decay_card,
        presence    = presence_card,
        server_pulse= pulse_card,
        leaderboard = leaderboard_card,
        tribe       = tribe_card,
        rare_dinos  = rare_card,
        activity    = activity_card,
        homes       = _HomesCard(entries=home_entries),
    )


# ── Self-service requests (kick / rename) ────────────────────────────────────
#
# The panel INSERTs rows into ARKM_player_requests (plugin DB); every
# cluster server of ARKM-Login (>= 7.4.0) polls the table on a ~10 s
# timer and processes the requests whose player is online there:
#   kick   — force-disconnect the requester's own character (stuck /
#            ghost-session recovery); expires after 10 minutes.
#   rename — validated server-side by NameControl and applied while the
#            player is online (or at the next login, within 7 days).
# The table is owned and created by the plugin — a missing table means
# the plugin is not updated yet, answered as 503.

_REQUESTS_TABLE_HINT = (
    "Player-request queue not available: the ARKM-Login plugin on the "
    "game servers has not been updated to a version that supports web "
    "requests yet."
)


class _RenameRequest(BaseModel):
    new_name: str


class _PlayerRequestRow(BaseModel):
    id:            int
    action:        str
    payload:       str
    status:        str
    result:        str
    requested_at:  Optional[str] = None
    processed_at:  Optional[str] = None


def _is_missing_table_error(exc: Exception) -> bool:
    """MySQL 1146 'table doesn't exist' — the plugin owns the schema."""
    return "1146" in str(exc) or "doesn't exist" in str(exc)


async def _pending_request_exists(
    plugin_db: AsyncSession, eos_id: str, action: str,
) -> bool:
    row = (await plugin_db.execute(
        text(
            "SELECT id FROM ARKM_player_requests "
            "WHERE eos_id = :e AND action = :a AND status = 'pending' LIMIT 1"
        ),
        {"e": eos_id, "a": action},
    )).fetchone()
    return row is not None


@router.get("/requests", response_model=list[_PlayerRequestRow])
async def list_my_requests(
    player:    _PlayerSession = Depends(get_current_player),
    plugin_db: AsyncSession   = Depends(get_plugin_db),
):
    """Last 10 self-service requests of the caller, newest first."""
    try:
        rows = (await plugin_db.execute(
            text(
                "SELECT id, action, payload, status, result, "
                "       requested_at, processed_at "
                "FROM ARKM_player_requests WHERE eos_id = :e "
                "ORDER BY id DESC LIMIT 10"
            ),
            {"e": player.eos_id},
        )).mappings().fetchall()
    except Exception as exc:  # noqa: BLE001 — surface a clean 503 on missing table
        if _is_missing_table_error(exc):
            return []
        raise
    return [
        _PlayerRequestRow(
            id           = r["id"],
            action       = r["action"],
            payload      = r["payload"],
            status       = r["status"],
            result       = r["result"],
            requested_at = (r["requested_at"].isoformat()
                            if r.get("requested_at") is not None
                               and hasattr(r["requested_at"], "isoformat") else None),
            processed_at = (r["processed_at"].isoformat()
                            if r.get("processed_at") is not None
                               and hasattr(r["processed_at"], "isoformat") else None),
        )
        for r in rows
    ]


@router.post("/requests/kick")
async def request_self_kick(
    request:   Request,
    player:    _PlayerSession = Depends(get_current_player),
    db:        AsyncSession   = Depends(get_db),
    plugin_db: AsyncSession   = Depends(get_plugin_db),
):
    """
    Queue a kick of the caller's own character.

    Only meaningful while a session is registered (stuck character /
    ghost session): with no active session there is nothing to kick and
    the request would just expire, so it is refused up front with 409.
    """
    sess = (await plugin_db.execute(
        text("SELECT server_key FROM ARKM_sessions WHERE eos_id = :e LIMIT 1"),
        {"e": player.eos_id},
    )).fetchone()
    if not sess:
        raise HTTPException(
            status_code=409,
            detail="You are not online on any server right now.",
        )

    try:
        if await _pending_request_exists(plugin_db, player.eos_id, "kick"):
            raise HTTPException(
                status_code=409, detail="A kick request is already pending.",
            )
        await plugin_db.execute(
            text(
                "INSERT INTO ARKM_player_requests (eos_id, action, payload) "
                "VALUES (:e, 'kick', '')"
            ),
            {"e": player.eos_id},
        )
        await plugin_db.commit()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        if _is_missing_table_error(exc):
            raise HTTPException(status_code=503, detail=_REQUESTS_TABLE_HINT) from None
        raise

    await audit_event(
        db, action="me.request_kick",
        username=f"discord:{player.discord_user_id}",
        detail=f"eos={player.eos_id} server={sess[0]}",
        request=request,
    )
    return {"ok": True}


@router.post("/requests/rename")
async def request_rename(
    data:      _RenameRequest,
    request:   Request,
    player:    _PlayerSession = Depends(get_current_player),
    db:        AsyncSession   = Depends(get_db),
    plugin_db: AsyncSession   = Depends(get_plugin_db),
):
    """
    Queue a character rename.

    Only cheap sanity checks happen here (length, printable characters):
    the authoritative validation — NameControl filters and cluster-wide
    uniqueness — runs in the plugin when the request is applied, and a
    rejection shows up in the request status. A new request supersedes a
    still-pending one.
    """
    new_name = data.new_name.strip()
    if not (2 <= len(new_name) <= 48):
        raise HTTPException(
            status_code=422,
            detail="The new name must be between 2 and 48 characters.",
        )
    if any(ord(c) < 32 for c in new_name):
        raise HTTPException(status_code=422, detail="Invalid characters in name.")

    try:
        # Supersede any still-pending rename instead of stacking them.
        await plugin_db.execute(
            text(
                "UPDATE ARKM_player_requests "
                "SET status = 'superseded', processed_at = NOW() "
                "WHERE eos_id = :e AND action = 'rename' AND status = 'pending'"
            ),
            {"e": player.eos_id},
        )
        await plugin_db.execute(
            text(
                "INSERT INTO ARKM_player_requests (eos_id, action, payload) "
                "VALUES (:e, 'rename', :p)"
            ),
            {"e": player.eos_id, "p": new_name},
        )
        await plugin_db.commit()
    except Exception as exc:  # noqa: BLE001
        if _is_missing_table_error(exc):
            raise HTTPException(status_code=503, detail=_REQUESTS_TABLE_HINT) from None
        raise

    await audit_event(
        db, action="me.request_rename",
        username=f"discord:{player.discord_user_id}",
        detail=f"eos={player.eos_id} new_name={new_name!r}",
        request=request,
    )
    return {"ok": True}


# ── Saved homes ──────────────────────────────────────────────────────────────

@router.delete("/homes/{home_id}")
async def delete_my_home(
    home_id:   int,
    request:   Request,
    player:    _PlayerSession = Depends(get_current_player),
    db:        AsyncSession   = Depends(get_db),
    plugin_db: AsyncSession   = Depends(get_plugin_db),
):
    """
    Delete one of the caller's own saved teleport homes.

    The DELETE is scoped by ``eos_id`` as well as ``id``: the id alone
    comes from the client and would otherwise let any logged-in player
    erase another player's home by guessing a number.  A row that does
    not belong to the caller is indistinguishable from one that does not
    exist, and both answer 404.

    No cache to invalidate: ARKM-Teleport reads ARKM_homes on every
    /home and /homes, so the deletion is effective in game immediately,
    even for a player who is online right now.
    """
    res = await plugin_db.execute(
        text("DELETE FROM ARKM_homes WHERE id = :i AND eos_id = :e"),
        {"i": home_id, "e": player.eos_id},
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Home not found.")
    await plugin_db.commit()

    await audit_event(
        db, action="me.home_delete",
        username=f"discord:{player.discord_user_id}",
        detail=f"eos={player.eos_id} home_id={home_id}",
        request=request,
    )
    return {"ok": True}


# ── GDPR endpoints (Art. 17 / 20) ────────────────────────────────────────────

@router.get("/privacy/export")
async def export_my_data(
    request:   Request,
    account:   dict          = Depends(get_current_discord_account),
    db:        AsyncSession  = Depends(get_db),
    plugin_db: AsyncSession  = Depends(get_plugin_db),
):
    """
    GDPR Art. 20 (data portability): return every piece of personal data
    the panel stores about the authenticated Discord identity, as JSON.

    OAuth token ciphertexts are excluded (they are credentials, not
    personal data, and exporting them would be a security hole) — their
    existence and expiry are reported instead.
    """
    export: dict = {
        "discord_account": {
            "discord_user_id":     account.get("discord_user_id"),
            "discord_username":    account.get("discord_username"),
            "discord_global_name": account.get("discord_global_name"),
            "discord_avatar":      account.get("discord_avatar"),
            "oauth_scope":         account.get("scope"),
            "oauth_tokens_stored": bool(account.get("token_expires_at")),
            "token_expires_at":    account.get("token_expires_at"),
            "linked_eos_id":       account.get("eos_id"),
            "linked_at":           account.get("linked_at"),
            "last_sync_at":        account.get("last_sync_at"),
            "created_at":          account.get("created_at"),
            "updated_at":          account.get("updated_at"),
        },
        "ark_player": None,
    }

    eos = account.get("eos_id")
    if eos:
        p_row = (await plugin_db.execute(
            text(
                "SELECT EOS_Id, Giocatore, PermissionGroups, TimedPermissionGroups "
                "FROM Players WHERE EOS_Id = :e LIMIT 1"
            ),
            {"e": eos},
        )).mappings().fetchone()
        if p_row:
            export["ark_player"] = {
                "eos_id":                  p_row["EOS_Id"],
                "character_name":          p_row.get("Giocatore"),
                "permission_groups":       p_row.get("PermissionGroups"),
                "timed_permission_groups": p_row.get("TimedPermissionGroups"),
            }

    await audit_event(
        db, action="gdpr.export",
        username=f"discord:{account.get('discord_user_id')}",
        request=request,
    )
    return export


@router.delete("/privacy/account")
async def delete_my_account(
    request: Request,
    account: dict         = Depends(get_current_discord_account),
    db:      AsyncSession = Depends(get_db),
):
    """
    GDPR Art. 17 (right to erasure): delete the Discord identity the
    panel stores for the authenticated session — profile fields, the
    encrypted OAuth tokens and the player link — then clear the session
    cookie.

    The auto-provisioned ``discord:<id>`` AppUser stub (created by the
    whitelist login flow) is removed too, because its username embeds
    the Discord ID.  Manually-created panel accounts are NOT touched:
    they are the operator's data, unlinked rather than erased.
    In-game data (Players, shop, leaderboard rows keyed by EOS ID) is
    game data owned by the server plugins and is out of scope here.
    """
    discord_user_id = str(account.get("discord_user_id"))

    # Drop the auto-provisioned stub AppUser, if any.  The stub is
    # recognisable by its reserved "discord:<id>" username (':' is not
    # allowed in human-created usernames).
    await db.execute(
        text("DELETE FROM arkmaniagest_users WHERE username = :u"),
        {"u": f"discord:{discord_user_id}"},
    )
    await db.execute(
        text("DELETE FROM arkmaniagest_discord_accounts WHERE discord_user_id = :d"),
        {"d": discord_user_id},
    )
    await db.commit()

    # The audit row keeps only the numeric Discord ID (needed to prove
    # the erasure happened) and is itself purged by the retention job.
    await audit_event(
        db, action="gdpr.account_delete",
        username=f"discord:{discord_user_id}",
        request=request,
    )

    resp = JSONResponse({"ok": True, "message": "Your Discord data has been deleted."})
    resp.delete_cookie(_SESSION_COOKIE, path="/")
    return resp
