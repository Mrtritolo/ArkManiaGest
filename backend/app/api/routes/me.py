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
        roster = (await plugin_db.execute(
            text(
                "SELECT pt.eos_id, MAX(pt.last_login) AS last_login, "
                "       COALESCE(NULLIF(p.Giocatore, ''), pt.player_name) AS name "
                "FROM ARKM_player_tribes pt "
                "LEFT JOIN Players p ON p.EOS_Id = pt.eos_id "
                "WHERE pt.targeting_team = :t "
                "GROUP BY pt.eos_id "
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
    )
