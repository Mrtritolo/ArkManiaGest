"""
api/routes/public.py — Read-only public API for external websites.

All endpoints are protected by an API key + origin/IP check rather than JWT
so that a public website can call them without a user session.

Exposed data: player names, permission groups, leaderboard rankings.
Never exposed: EOS IDs, shop points, kit cooldowns, internal paths.
"""
import time
from typing import List, Optional
from datetime import datetime, timezone
from collections import defaultdict

from fastapi import APIRouter, Depends, Query, Request, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, update

from app.db.session import get_plugin_db
from app.db.models.ark import Player, ArkShopPlayer
from sqlalchemy import text as sa_text
from app.core.config import server_settings
from app.core.store import get_machine_sync, get_plugin_config_sync
from app.ssh.manager import SSHManager
from app.ssh.profile_parser import scan_and_match_profiles

router = APIRouter()

# ── Security configuration ────────────────────────────────────────────────────

def _build_allowed_origins() -> set[str]:
    """Build the allowed origins set from config + localhost defaults."""
    origins = {"http://localhost", "http://127.0.0.1"}
    raw = server_settings.PUBLIC_ALLOWED_ORIGINS
    if raw:
        origins.update(o.strip() for o in raw.split(",") if o.strip())
    return origins


def _build_allowed_server_ips() -> set[str]:
    """Build the allowed server IPs set from config + localhost defaults."""
    ips = {"127.0.0.1", "::1"}
    raw = server_settings.PUBLIC_SERVER_IPS
    if raw:
        ips.update(ip.strip() for ip in raw.split(",") if ip.strip())
    return ips


_ALLOWED_ORIGINS: set[str] = _build_allowed_origins()
_ALLOWED_SERVER_IPS: set[str] = _build_allowed_server_ips()

# Simple in-memory rate limiter (resets on restart)
_RATE_LIMITS: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_WINDOW = 60   # seconds
_RATE_LIMIT_MAX    = 30   # requests per window


def _check_rate_limit(client_ip: str) -> bool:
    """Return True if the request is within the allowed rate."""
    now          = time.time()
    window_start = now - _RATE_LIMIT_WINDOW
    _RATE_LIMITS[client_ip] = [t for t in _RATE_LIMITS[client_ip] if t > window_start]
    if len(_RATE_LIMITS[client_ip]) >= _RATE_LIMIT_MAX:
        return False
    _RATE_LIMITS[client_ip].append(now)
    return True


def _validate_request(request: Request, api_key: Optional[str] = None) -> None:
    """
    Validate a public API request.

    Checks (in order):
      1. API key present and correct
      2. Origin/Referer header matches an allowed origin, OR client IP is an
         allowed server IP
      3. Rate limit not exceeded

    Raises:
        HTTPException 403: Key invalid, or origin/IP not allowed.
        HTTPException 429: Rate limit exceeded.
    """
    key = api_key or request.headers.get("X-API-Key", "")
    if key != server_settings.PUBLIC_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key.")

    origin    = request.headers.get("origin", "")
    referer   = request.headers.get("referer", "")
    client_ip = request.client.host if request.client else ""

    origin_ok  = any(origin.startswith(o)  for o in _ALLOWED_ORIGINS) if origin  else False
    referer_ok = any(referer.startswith(o) for o in _ALLOWED_ORIGINS) if referer else False
    ip_ok      = client_ip in _ALLOWED_SERVER_IPS

    if not (origin_ok or referer_ok or ip_ok):
        raise HTTPException(status_code=403, detail="Unauthorized origin.")

    if not _check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests. Please try again in a minute.")


# ── Public player list ─────────────────────────────────────────────────────────

def _determine_status(groups: list[str]) -> str:
    """Derive a display status string from a player's active permission groups."""
    groups_lower = [g.lower() for g in groups]
    if any("admin" in g for g in groups_lower):
        return "Admin"
    if any("vip" in g for g in groups_lower):
        return "VIP"
    if any("member" in g or "membro" in g for g in groups_lower):
        return "Member"
    if groups:
        return groups[0]
    return "Default"


@router.get("/players")
async def public_players_list(
    request:   Request,
    search:    Optional[str] = Query(None),
    limit:     int           = Query(100, ge=1, le=500),
    offset:    int           = Query(0, ge=0),
    api_key:   Optional[str] = Query(None, alias="key"),
    db:        AsyncSession  = Depends(get_plugin_db),
):
    """
    Public player list for the external website.

    Returns player name, permission groups, timed groups, and tribe.
    EOS IDs, shop data, and internal paths are never returned.
    """
    _validate_request(request, api_key)

    base_query = (
        select(
            Player.Id, Player.EOS_Id, Player.Giocatore,
            Player.PermissionGroups, Player.TimedPermissionGroups,
        )
        .where(Player.Giocatore.isnot(None))
        .where(Player.Giocatore != "")
    )

    # Total count before search filter
    total_all_result = await db.execute(
        select(func.count()).select_from(
            select(Player.Id)
            .where(Player.Giocatore.isnot(None))
            .where(Player.Giocatore != "")
            .subquery()
        )
    )
    total_all = total_all_result.scalar() or 0

    # Apply search filter
    if search:
        like = f"%{search}%"
        history_result = await db.execute(
            sa_text("SELECT eos_id FROM ARKM_players WHERE player_name LIKE :like"),
            {"like": like},
        )
        matching_eos_ids = {r[0] for r in history_result.fetchall()}
        if matching_eos_ids:
            base_query = base_query.where(
                or_(Player.Giocatore.ilike(like), Player.EOS_Id.in_(matching_eos_ids))
            )
        else:
            base_query = base_query.where(Player.Giocatore.ilike(like))

    # Count after filter
    filtered_result = await db.execute(
        select(func.count()).select_from(base_query.subquery())
    )
    total_filtered = filtered_result.scalar() or 0

    # Paginated data
    paginated = base_query.order_by(Player.Giocatore.asc()).limit(limit).offset(offset)
    rows = (await db.execute(paginated)).all()

    # Fetch tribe names and last logout from auxiliary tables
    eos_ids = [r.EOS_Id for r in rows if r.EOS_Id]
    tribe_map: dict[str, str]   = {}  # eos_id -> tribe_name
    login_map: dict[str, int]   = {}  # eos_id -> last_logout unix timestamp

    if eos_ids:
        placeholders = ", ".join(f":e{i}" for i in range(len(eos_ids)))
        params       = {f"e{i}": eid for i, eid in enumerate(eos_ids)}

        # Last logout from player history
        history_res = await db.execute(
            sa_text(
                f"SELECT eos_id, last_logout "
                f"FROM ARKM_players WHERE eos_id IN ({placeholders})"
            ),
            params,
        )
        for hr in history_res.fetchall():
            if hr[1]:
                login_map[hr[0]] = int(hr[1].timestamp()) if hasattr(hr[1], "timestamp") else 0

        # Tribe name from player_tribes (most recent login per player)
        tribe_res = await db.execute(
            sa_text(
                f"SELECT eos_id, tribe_name "
                f"FROM ARKM_player_tribes WHERE eos_id IN ({placeholders}) "
                f"ORDER BY last_login DESC"
            ),
            params,
        )
        for tr in tribe_res.fetchall():
            # Keep only the first (most recent) entry per eos_id
            if tr[0] not in tribe_map and tr[1] and tr[1].strip():
                tribe_map[tr[0]] = tr[1].strip()

    now_ts = int(datetime.now(timezone.utc).timestamp())
    items  = []

    for r in rows:
        name = r.Giocatore
        if not name or not name.strip():
            continue

        # Parse permanent permission groups
        perm_groups = [
            g.strip()
            for g in (r.PermissionGroups or "").split(",")
            if g.strip() and g.strip() != "Default"
        ]

        # Parse timed permission groups
        timed_groups = []
        if r.TimedPermissionGroups and r.TimedPermissionGroups.strip():
            for entry in r.TimedPermissionGroups.split(","):
                if not entry.strip():
                    continue
                parts = entry.strip().split(";")
                if len(parts) >= 3:
                    group   = parts[2].strip()
                    ts      = int(parts[1]) if parts[1].isdigit() else 0
                    expired = ts > 0 and ts < now_ts
                    if group:
                        timed_groups.append({
                            "group":      group,
                            "expires_at": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts > 0 else None,
                            "expired":    expired,
                        })

        active_groups = perm_groups + [
            tg["group"] for tg in timed_groups if not tg["expired"]
        ]
        status = _determine_status(active_groups)

        last_login_ts = login_map.get(r.EOS_Id)
        last_login    = (
            datetime.fromtimestamp(last_login_ts, tz=timezone.utc).isoformat()
            if last_login_ts and last_login_ts > 0
            else None
        )

        items.append({
            "name":        name,
            "status":      status,
            "groups":      perm_groups,
            "timed_groups":timed_groups,
            "tribe":       tribe_map.get(r.EOS_Id),
            "last_login":  last_login,
            "decay_day":   None,
        })

    # Sort: Admins/VIPs first, then alphabetical
    _STATUS_ORDER = {"Admin": 0, "VIP": 1, "Member": 2, "Default": 3}
    items.sort(key=lambda x: (_STATUS_ORDER.get(x["status"], 9), x["name"].lower()))

    return {
        "players":    items,
        "total":      total_filtered,
        "total_all":  total_all,
        "limit":      limit,
        "offset":     offset,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Cron: sync player names ────────────────────────────────────────────────────

@router.post("/cron/sync-names")
async def cron_sync_names(
    request: Request,
    secret:  str           = Query(...),
    db:      AsyncSession  = Depends(get_plugin_db),
):
    """
    Cron job: scan ``.arkprofile`` files via SSH and update player names in DB.

    Protected by a shared secret and restricted to localhost callers.
    Deduplicates by EOS ID (first profile wins).
    """
    if secret != server_settings.CRON_SECRET:
        raise HTTPException(status_code=403, detail="Invalid cron secret.")

    client_ip = request.client.host if request.client else ""
    if client_ip not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="Local requests only.")

    containers_map = get_plugin_config_sync("containers_map")
    if not containers_map or not containers_map.get("machines"):
        return {"success": False, "error": "No containers scanned."}

    all_players_result = await db.execute(
        select(Player.Id, Player.EOS_Id, Player.Giocatore)
    )
    eos_map = {
        p.EOS_Id.lower(): {"id": p.Id, "eos_id": p.EOS_Id, "current_name": p.Giocatore}
        for p in all_players_result.all()
        if p.EOS_Id
    }

    total_profiles = 0
    matched        = 0
    updated_count  = 0
    seen_eos_ids: set[str] = set()
    errors: list[str]      = []

    for mid, mdata in containers_map["machines"].items():
        machine = get_machine_sync(int(mid))
        if not machine:
            errors.append(f"Machine {mid} not found")
            continue

        saved_paths = [
            c.get("paths", {}).get("saved_arks")
            for c in mdata.get("containers", [])
            if c.get("paths", {}).get("saved_arks")
        ]
        if not saved_paths:
            continue

        try:
            with SSHManager(
                host=machine["hostname"],
                username=machine["ssh_user"],
                password=machine.get("ssh_password"),
                key_path=machine.get("ssh_key_path"),
                port=machine.get("ssh_port", 22),
            ) as ssh:
                profiles = scan_and_match_profiles(ssh, saved_paths)
        except Exception as exc:
            errors.append(f"SSH {machine['hostname']}: {exc}")
            continue

        for prof in profiles:
            total_profiles += 1
            player_name    = prof.get("player_name")
            profile_eos_id = prof.get("eos_id")
            file_id        = prof["file_id"].lower()

            if not player_name:
                continue

            # Determine the canonical EOS ID to update
            ref_eos = None
            if profile_eos_id and profile_eos_id.lower() in eos_map:
                ref_eos = profile_eos_id.lower()
            elif file_id in eos_map:
                ref_eos = file_id
            else:
                if profile_eos_id:
                    eos_lower = profile_eos_id.lower()
                    for db_eos in eos_map:
                        if eos_lower in db_eos or db_eos in eos_lower:
                            ref_eos = db_eos
                            break

            if not ref_eos or ref_eos in seen_eos_ids:
                continue
            seen_eos_ids.add(ref_eos)

            player_data = eos_map[ref_eos]
            matched += 1

            if player_data["current_name"] != player_name:
                await db.execute(
                    update(Player)
                    .where(Player.Id == player_data["id"])
                    .values(Giocatore=player_name)
                )
                updated_count += 1

    await db.commit()

    return {
        "success":               True,
        "total_profiles_scanned":total_profiles,
        "matched":               matched,
        "updated":               updated_count,
        "deduped_eos_ids":       len(seen_eos_ids),
        "errors":                errors,
        "timestamp":             datetime.now(timezone.utc).isoformat(),
    }


# ── Public leaderboard ─────────────────────────────────────────────────────────

@router.get("/leaderboard")
async def public_leaderboard(
    request:     Request,
    server_type: Optional[str] = Query(None, description="PvE or PvP"),
    sort_by:     str           = Query("total_points"),
    limit:       int           = Query(50, ge=1, le=100),
    offset:      int           = Query(0, ge=0),
    api_key:     Optional[str] = Query(None, alias="key"),
    db:          AsyncSession  = Depends(get_plugin_db),
):
    """
    Public leaderboard for the external website.

    Returns rank, player name, and aggregate stats.
    EOS IDs are never returned.
    """
    _validate_request(request, api_key)

    _ALLOWED_SORTS = frozenset([
        "total_points", "kills_wild", "kills_player", "tames", "crafts", "deaths"
    ])
    if sort_by not in _ALLOWED_SORTS:
        sort_by = "total_points"

    where: list[str] = []
    params: dict = {"lim": limit, "off": offset}

    if server_type and server_type in ("PvE", "PvP"):
        where.append("server_type = :stype")
        params["stype"] = server_type

    where_clause = "WHERE " + " AND ".join(where) if where else ""

    count_result = await db.execute(
        sa_text(
            f"SELECT COUNT(DISTINCT eos_id) FROM ARKM_lb_scores {where_clause}"
        ),
        params,
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        sa_text(
            f"SELECT player_name, server_type, total_points, "
            f"kills_wild, kills_enemy_dino, kills_player, tames, crafts, "
            f"structs_destroyed, deaths, last_event "
            f"FROM ARKM_lb_scores {where_clause} "
            f"ORDER BY {sort_by} DESC, total_points DESC "
            f"LIMIT :lim OFFSET :off"
        ),
        params,
    )

    items = []
    rank  = offset + 1
    for r in result.fetchall():
        items.append({
            "rank":               rank,
            "name":               r[0],
            "server_type":        r[1],
            "total_points":       r[2],
            "kills_wild":         r[3],
            "kills_enemy_dino":   r[4],
            "kills_player":       r[5],
            "tames":              r[6],
            "crafts":             r[7],
            "structs_destroyed":  r[8],
            "deaths":             r[9],
            "last_active":        str(r[10]) if r[10] else None,
        })
        rank += 1

    return {
        "leaderboard": items,
        "total":       total,
        "limit":       limit,
        "offset":      offset,
        "sort_by":     sort_by,
        "server_type": server_type,
        "updated_at":  datetime.now(timezone.utc).isoformat(),
    }


@router.get("/leaderboard/stats")
async def public_leaderboard_stats(
    request: Request,
    api_key: Optional[str] = Query(None, alias="key"),
    db:      AsyncSession  = Depends(get_plugin_db),
):
    """Return aggregate leaderboard statistics for the website."""
    _validate_request(request, api_key)

    result = await db.execute(
        sa_text(
            "SELECT "
            "  COUNT(DISTINCT eos_id)           AS players, "
            "  COALESCE(SUM(total_points), 0)   AS points, "
            "  COALESCE(SUM(kills_wild), 0)     AS kills, "
            "  COALESCE(SUM(tames), 0)          AS tames, "
            "  COALESCE(SUM(crafts), 0)         AS crafts, "
            "  COALESCE(SUM(deaths), 0)         AS deaths "
            "FROM ARKM_lb_scores"
        )
    )
    s = result.fetchone()

    top_result = await db.execute(
        sa_text(
            "SELECT player_name, total_points FROM ARKM_lb_scores "
            "ORDER BY total_points DESC LIMIT 3"
        )
    )
    top3 = [{"name": r[0], "points": r[1]} for r in top_result.fetchall()]

    return {
        "total_players": s[0] or 0,
        "total_points":  s[1] or 0,
        "total_kills":   s[2] or 0,
        "total_tames":   s[3] or 0,
        "total_crafts":  s[4] or 0,
        "total_deaths":  s[5] or 0,
        "top3":          top3,
        "updated_at":    datetime.now(timezone.utc).isoformat(),
    }


# ── Public rare dinos ─────────────────────────────────────────────────────────

def _display_name_from_bp(bp: str) -> str:
    """Derive a human-readable name from a blueprint path."""
    short = bp
    if "." in bp:
        short = bp.rsplit(".", 1)[-1].rstrip("'")
    if "/" in short:
        short = short.rsplit("/", 1)[-1]
    return (
        short.replace("_Character_BP", "")
             .replace("_Character_BP_ASA", "")
             .replace("_", " ")
             .replace("S-", "")
             .strip()
    )


@router.get("/rare-dinos")
async def public_rare_dinos(
    request:    Request,
    server_key: Optional[str] = Query(None),
    map_name:   Optional[str] = Query(None),
    api_key:    Optional[str] = Query(None, alias="key"),
    db:         AsyncSession   = Depends(get_plugin_db),
):
    """
    Public endpoint: currently alive rare dinos.

    A dino is "alive" if it has a SPAWN event with no subsequent
    KILLED, TAMED, or DESPAWN event on the same server.
    """
    _validate_request(request, api_key)

    where: list[str] = []
    params: dict = {}

    if server_key:
        where.append("rs.server_key = :sk")
        params["sk"] = server_key
    if map_name:
        where.append("rs.map_name = :mn")
        params["mn"] = map_name

    extra_where = ("AND " + " AND ".join(where)) if where else ""

    result = await db.execute(
        sa_text(
            f"SELECT rs.dino_name, rs.dino_level, rs.server_key, rs.map_name, "
            f"rs.gps_lat, rs.gps_lon, rs.event_time, "
            f"srv.display_name "
            f"FROM ARKM_rare_spawns rs "
            f"LEFT JOIN ARKM_servers srv ON srv.server_key = rs.server_key "
            f"WHERE rs.event_type = 'SPAWN' "
            f"AND NOT EXISTS ( "
            f"  SELECT 1 FROM ARKM_rare_spawns rs2 "
            f"  WHERE rs2.dino_blueprint = rs.dino_blueprint "
            f"    AND rs2.server_key = rs.server_key "
            f"    AND rs2.event_type IN ('KILLED', 'TAMED', 'DESPAWN') "
            f"    AND rs2.event_time > rs.event_time "
            f") "
            f"{extra_where} "
            f"ORDER BY rs.event_time DESC"
        ),
        params,
    )

    dinos = [
        {
            "name":        r[0] or "Unknown",
            "level":       r[1],
            "server":      r[2],
            "server_name": r[7] or r[2],
            "map":         r[3],
            "lat":         r[4],
            "lon":         r[5],
            "spawned_at":  str(r[6]) if r[6] else None,
        }
        for r in result.fetchall()
    ]

    return {
        "dinos":     dinos,
        "count":     len(dinos),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/rare-dinos/pool")
async def public_rare_dinos_pool(
    request: Request,
    api_key: Optional[str] = Query(None, alias="key"),
    db:      AsyncSession   = Depends(get_plugin_db),
):
    """
    Public endpoint: configured rare dino pool (what can spawn).

    Only returns display name and map — no stats or blueprint paths.
    """
    _validate_request(request, api_key)

    result = await db.execute(
        sa_text(
            "SELECT dino_bp, map_name FROM ARKM_rare_dinos WHERE enabled = 1 "
            "ORDER BY dino_bp"
        )
    )

    pool = [
        {
            "name": _display_name_from_bp(r[0]),
            "map":  r[1] or "*",
        }
        for r in result.fetchall()
    ]

    return {
        "pool":  pool,
        "count": len(pool),
    }
