"""
api/routes/ARKM_config.py — Centralised plugin configuration editor.

Reads from and writes to the ``ARKM_config`` (key-value settings) and
``ARKM_servers`` tables.

All plugin settings are stored as ``server_key / config_key / config_value``
rows.  The global default uses ``server_key = '*'``; per-server overrides use
a specific server key and are merged on top of the global values at read time.

IMPORTANT — Required DB migration
----------------------------------
The ``ARKM_config`` table MUST have a composite UNIQUE index on
``(server_key, config_key)`` for the ON DUPLICATE KEY UPDATE upserts to work
correctly.  Run the following DDL once on the live database (after verifying
that no duplicate pairs exist):

    ALTER TABLE ARKM_config
        ADD UNIQUE KEY uq_server_config (server_key, config_key);

Without this index, every upsert inserts a new row instead of updating the
existing one, causing unbounded row duplication.
"""
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.db.session import get_plugin_db

router = APIRouter()

# ── Known module metadata ──────────────────────────────────────────────────────
KNOWN_MODULES: dict[str, dict] = {
    "Login":        {"icon": "LogIn",         "label": "Login & Whitelist"},
    "Plus":         {"icon": "Zap",           "label": "ArkMania Plus"},
    "RareDino":     {"icon": "Eye",           "label": "Rare Dino"},
    "ItemPlus":     {"icon": "Package",       "label": "Item Plus"},
    "ServerRules":  {"icon": "Shield",        "label": "Server Rules"},
    "DeadSaver":    {"icon": "Heart",         "label": "Dead Saver"},
    "CrossChat":    {"icon": "MessageSquare", "label": "Cross Chat"},
    "DecayManager": {"icon": "Timer",         "label": "Decay Manager"},
    "Discord":      {"icon": "Bell",          "label": "Discord"},
    "Messages":     {"icon": "MessageCircle", "label": "Messages"},
    "Leaderboard":  {"icon": "Trophy",        "label": "Leaderboard"},
    "LeaderBoard":  {"icon": "Trophy",        "label": "Leaderboard"},
    "nc":                {"icon": "UserCheck",     "label": "Name Control"},
    "te":                {"icon": "Users",         "label": "Tribe Engine"},
    "tl":                {"icon": "FileText",      "label": "Tribe Log"},
    "craftlimit":        {"icon": "Package",       "label": "Craft Limit"},
    "plus":              {"icon": "Zap",           "label": "Plus"},
    "PvPManager":        {"icon": "Swords",        "label": "PvP Manager"},
    "RangeManager":      {"icon": "Crosshair",     "label": "Range Manager"},
    "SpawnProtection":   {"icon": "ShieldAlert",   "label": "Spawn Protection"},
}


# ── Schemas ────────────────────────────────────────────────────────────────────

class ConfigItem(BaseModel):
    config_key:   str
    config_value: str
    description:  Optional[str] = None
    server_key:   str = "*"


class ConfigUpdate(BaseModel):
    config_key:   str
    config_value: str
    description:  Optional[str] = None


class BulkConfigUpdate(BaseModel):
    server_key: str = "*"
    items: List[ConfigUpdate]


class ServerCreate(BaseModel):
    """Required fields for registering a new game server."""
    server_key:    str
    display_name:  str
    map_name:      str
    game_mode:     str = "PvE"
    server_type:   str = "PvE"
    cluster_group: str = "default"
    max_players:   int = 70


class ServerUpdate(BaseModel):
    """Partial update for an ARKM_servers row."""
    display_name:  Optional[str] = None
    map_name:      Optional[str] = None
    game_mode:     Optional[str] = None
    server_type:   Optional[str] = None
    cluster_group: Optional[str] = None
    max_players:   Optional[int] = None


# ── Module endpoints ───────────────────────────────────────────────────────────

@router.get("/modules")
async def list_modules(db: AsyncSession = Depends(get_plugin_db)):
    """
    List all config modules with their key counts.

    Modules are derived from the prefix (first component before ``'.'``) of
    each ``config_key`` row where ``server_key = '*'``.
    """
    result = await db.execute(
        text(
            "SELECT config_key FROM ARKM_config "
            "WHERE server_key = '*' ORDER BY config_key"
        )
    )
    module_counts: dict[str, int] = {}
    for (key,) in result.fetchall():
        prefix = key.split(".")[0] if "." in key else key
        module_counts[prefix] = module_counts.get(prefix, 0) + 1

    modules = []
    for prefix, count in sorted(module_counts.items()):
        meta = KNOWN_MODULES.get(prefix, {"icon": "Settings", "label": prefix})
        modules.append({
            "prefix":    prefix,
            "label":     meta["label"],
            "icon":      meta["icon"],
            "key_count": count,
        })

    return {"modules": modules, "total_keys": sum(module_counts.values())}


@router.get("/modules/{module}")
async def get_module_config(
    module: str,
    server_key: str = Query("*", description="'*' for global, specific key for overrides"),
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    Read all config keys for a module, merging per-server overrides onto globals.

    When ``server_key = '*'`` only global values are returned.
    When a specific server key is supplied, overrides are merged on top of the
    corresponding global values (override wins).
    """
    prefix = module + ".%"

    global_result = await db.execute(
        text(
            "SELECT config_key, config_value, description "
            "FROM ARKM_config "
            "WHERE server_key = '*' AND config_key LIKE :prefix ORDER BY config_key"
        ),
        {"prefix": prefix},
    )
    globals_: dict[str, dict] = {
        r[0]: {"value": r[1], "description": r[2]}
        for r in global_result.fetchall()
    }

    overrides: dict[str, dict] = {}
    if server_key != "*":
        override_result = await db.execute(
            text(
                "SELECT config_key, config_value, description "
                "FROM ARKM_config "
                "WHERE server_key = :sk AND config_key LIKE :prefix ORDER BY config_key"
            ),
            {"sk": server_key, "prefix": prefix},
        )
        overrides = {
            r[0]: {"value": r[1], "description": r[2]}
            for r in override_result.fetchall()
        }

    items = []
    short_prefix = module + "."

    # Merge: per-server override wins over global
    for key, g in globals_.items():
        ov = overrides.get(key)
        items.append({
            "config_key":     key,
            "short_key":      key[len(short_prefix):] if key.startswith(short_prefix) else key,
            "value":          ov["value"] if ov else g["value"],
            "global_value":   g["value"],
            "description":    g["description"] or "",
            "is_overridden":  key in overrides,
            "override_value": ov["value"] if ov else None,
        })

    # Include override-only keys (no matching global)
    for key, ov in overrides.items():
        if key not in globals_:
            items.append({
                "config_key":     key,
                "short_key":      key[len(short_prefix):] if key.startswith(short_prefix) else key,
                "value":          ov["value"],
                "global_value":   None,
                "description":    ov["description"] or "",
                "is_overridden":  True,
                "override_value": ov["value"],
            })

    return {
        "module":     module,
        "server_key": server_key,
        "label":      KNOWN_MODULES.get(module, {}).get("label", module),
        "items":      items,
    }


@router.put("/modules/{module}")
async def update_module_config(
    module: str,
    body: BulkConfigUpdate,
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    Bulk-update config keys belonging to a module.

    NOTE: requires the UNIQUE index uq_server_config(server_key, config_key)
    to be present on ARKM_config — see module docstring.

    Raises:
        HTTPException 400: A key in the payload does not belong to the module.
    """
    updated = 0
    for item in body.items:
        if not item.config_key.startswith(module + "."):
            raise HTTPException(
                status_code=400,
                detail=f"Key '{item.config_key}' does not belong to module '{module}'",
            )
        await db.execute(
            text(
                "INSERT INTO ARKM_config (server_key, config_key, config_value, description) "
                "VALUES (:sk, :ck, :cv, :desc) "
                "ON DUPLICATE KEY UPDATE "
                "config_value = :cv, description = COALESCE(:desc, description)"
            ),
            {
                "sk":   body.server_key,
                "ck":   item.config_key,
                "cv":   item.config_value,
                "desc": item.description,
            },
        )
        updated += 1

    # Transaction committed by get_plugin_db dependency on success.
    return {"updated": updated, "server_key": body.server_key}


# ── Single key endpoints ───────────────────────────────────────────────────────

@router.get("/config")
async def get_config_value(
    key: str = Query(..., description="Full config key, e.g. Login.BanEnabled"),
    server_key: str = Query("*"),
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    Read a single config value, falling back to the global default.

    The ORDER BY ensures that a per-server override (lower CASE value = 0)
    is returned before the global wildcard (CASE value = 1).
    """
    result = await db.execute(
        text(
            "SELECT config_value, description, server_key FROM ARKM_config "
            "WHERE config_key = :ck AND server_key IN (:sk, '*') "
            "ORDER BY CASE server_key WHEN '*' THEN 1 ELSE 0 END LIMIT 1"
        ),
        {"ck": key, "sk": server_key},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Config '{key}' not found")
    return {
        "config_key":    key,
        "config_value":  row[0],
        "description":   row[1],
        "source_server": row[2],
    }


@router.put("/config")
async def set_config_value(item: ConfigItem, db: AsyncSession = Depends(get_plugin_db)):
    """
    Upsert a single config value.

    NOTE: requires the UNIQUE index uq_server_config(server_key, config_key)
    to be present on ARKM_config — see module docstring.
    """
    await db.execute(
        text(
            "INSERT INTO ARKM_config (server_key, config_key, config_value, description) "
            "VALUES (:sk, :ck, :cv, :desc) "
            "ON DUPLICATE KEY UPDATE "
            "config_value = :cv, description = COALESCE(:desc, description)"
        ),
        {
            "sk":   item.server_key,
            "ck":   item.config_key,
            "cv":   item.config_value,
            "desc": item.description,
        },
    )
    # Transaction committed by get_plugin_db dependency on success.
    return {"saved": True, "config_key": item.config_key, "server_key": item.server_key}


@router.post("/config")
async def add_config_key(item: ConfigItem, db: AsyncSession = Depends(get_plugin_db)):
    """
    Insert a new config key (fails if the key already exists for the server).

    Raises:
        HTTPException 409: Key already exists.
    """
    exists = await db.execute(
        text(
            "SELECT 1 FROM ARKM_config "
            "WHERE config_key = :ck AND server_key = :sk"
        ),
        {"ck": item.config_key, "sk": item.server_key},
    )
    if exists.fetchone():
        raise HTTPException(
            status_code=409,
            detail=(
                f"Config '{item.config_key}' already exists "
                f"for server_key='{item.server_key}'"
            ),
        )
    await db.execute(
        text(
            "INSERT INTO ARKM_config (server_key, config_key, config_value, description) "
            "VALUES (:sk, :ck, :cv, :desc)"
        ),
        {
            "sk":   item.server_key,
            "ck":   item.config_key,
            "cv":   item.config_value,
            "desc": item.description,
        },
    )
    # Transaction committed by get_plugin_db dependency on success.
    return {"created": True, "config_key": item.config_key}


@router.delete("/config")
async def delete_config_override(
    key: str = Query(...),
    server_key: str = Query(..., description="Only server-specific overrides can be deleted"),
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    Delete a per-server config override.

    Global (``server_key='*'``) entries cannot be deleted through this endpoint.
    """
    if server_key == "*":
        raise HTTPException(status_code=400, detail="Global config entries cannot be deleted")
    result = await db.execute(
        text(
            "DELETE FROM ARKM_config "
            "WHERE config_key = :ck AND server_key = :sk"
        ),
        {"ck": key, "sk": server_key},
    )
    # Transaction committed by get_plugin_db dependency on success.
    return {"deleted": result.rowcount > 0}


# ── Server management ──────────────────────────────────────────────────────────

@router.get("/servers")
async def list_servers(db: AsyncSession = Depends(get_plugin_db)):
    """Return all servers registered in ``ARKM_servers``."""
    result = await db.execute(
        text(
            "SELECT server_key, display_name, map_name, game_mode, server_type, "
            "cluster_group, max_players, is_online, player_count, last_heartbeat "
            "FROM ARKM_servers ORDER BY display_name"
        )
    )
    servers = [
        {
            "server_key":     r[0],
            "display_name":   r[1],
            "map_name":       r[2],
            "game_mode":      r[3],
            "server_type":    r[4],
            "cluster_group":  r[5],
            "max_players":    r[6],
            "is_online":      bool(r[7]),
            "player_count":   r[8],
            "last_heartbeat": str(r[9]) if r[9] else None,
        }
        for r in result.fetchall()
    ]
    return {"servers": servers}


@router.put("/servers/{server_key}")
async def update_server(
    server_key: str,
    body: ServerUpdate,
    db: AsyncSession = Depends(get_plugin_db),
):
    """Update display metadata for a server record."""
    set_clauses: list[str] = []
    params: dict = {"sk": server_key}

    field_map = {
        "display_name":  ("dn", "display_name"),
        "map_name":      ("mn", "map_name"),
        "game_mode":     ("gm", "game_mode"),
        "server_type":   ("st", "server_type"),
        "cluster_group": ("cg", "cluster_group"),
        "max_players":   ("mp", "max_players"),
    }
    for attr, (param_key, col) in field_map.items():
        value = getattr(body, attr)
        if value is not None:
            set_clauses.append(f"{col} = :{param_key}")
            params[param_key] = value

    if not set_clauses:
        raise HTTPException(status_code=400, detail="No fields to update")

    await db.execute(
        text(
            f"UPDATE ARKM_servers SET {', '.join(set_clauses)} WHERE server_key = :sk"
        ),
        params,
    )
    # Transaction committed by get_plugin_db dependency on success.
    return {"updated": True, "server_key": server_key}


@router.post("/servers", status_code=201)
async def create_server(body: ServerCreate, db: AsyncSession = Depends(get_plugin_db)):
    """
    Register a new game server in ``ARKM_servers``.

    Raises:
        HTTPException 409: A server with the same ``server_key`` already exists.
    """
    exists = await db.execute(
        text("SELECT 1 FROM ARKM_servers WHERE server_key = :sk"),
        {"sk": body.server_key},
    )
    if exists.fetchone():
        raise HTTPException(
            status_code=409,
            detail=f"Server '{body.server_key}' already exists.",
        )
    await db.execute(
        text(
            "INSERT INTO ARKM_servers "
            "(server_key, display_name, map_name, game_mode, server_type, "
            "cluster_group, max_players) "
            "VALUES (:sk, :dn, :mn, :gm, :st, :cg, :mp)"
        ),
        {
            "sk": body.server_key,
            "dn": body.display_name,
            "mn": body.map_name,
            "gm": body.game_mode,
            "st": body.server_type,
            "cg": body.cluster_group,
            "mp": body.max_players,
        },
    )
    return {"created": True, "server_key": body.server_key}


@router.delete("/servers/{server_key}")
async def delete_server(server_key: str, db: AsyncSession = Depends(get_plugin_db)):
    """
    Delete a game server and all its config overrides.

    Also removes every ``ARKM_config`` row whose ``server_key`` matches.
    """
    result = await db.execute(
        text("DELETE FROM ARKM_servers WHERE server_key = :sk"),
        {"sk": server_key},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Server not found.")
    # Clean up per-server config overrides
    await db.execute(
        text("DELETE FROM ARKM_config WHERE server_key = :sk"),
        {"sk": server_key},
    )
    return {"deleted": True, "server_key": server_key}


@router.get("/servers/{server_key}/overrides")
async def get_server_overrides(server_key: str, db: AsyncSession = Depends(get_plugin_db)):
    """List all config overrides that apply to a specific server."""
    result = await db.execute(
        text(
            "SELECT config_key, config_value, description "
            "FROM ARKM_config WHERE server_key = :sk ORDER BY config_key"
        ),
        {"sk": server_key},
    )
    items = [
        {"config_key": r[0], "config_value": r[1], "description": r[2]}
        for r in result.fetchall()
    ]
    return {"server_key": server_key, "overrides": items, "count": len(items)}


# ── Search ─────────────────────────────────────────────────────────────────────

@router.get("/search")
async def search_config(
    q: str = Query(..., min_length=2),
    db: AsyncSession = Depends(get_plugin_db),
):
    """Full-text search across config key, value, and description fields."""
    pattern = f"%{q}%"
    result = await db.execute(
        text(
            "SELECT server_key, config_key, config_value, description "
            "FROM ARKM_config "
            "WHERE config_key LIKE :p OR config_value LIKE :p OR description LIKE :p "
            "ORDER BY server_key, config_key LIMIT 100"
        ),
        {"p": pattern},
    )
    items = [
        {"server_key": r[0], "config_key": r[1], "config_value": r[2], "description": r[3]}
        for r in result.fetchall()
    ]
    return {"query": q, "results": items, "count": len(items)}


# ── Permission groups ──────────────────────────────────────────────────────────

@router.get("/permission-groups")
async def list_permission_groups(db: AsyncSession = Depends(get_plugin_db)):
    """Return all permission group names (used to populate dropdowns)."""
    result = await db.execute(
        text("SELECT GroupName FROM PermissionGroups ORDER BY GroupName")
    )
    return {"groups": [r[0] for r in result.fetchall()]}


# ── Online players ─────────────────────────────────────────────────────────────

@router.get("/online")
async def get_online_players(
    server_key: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    Return currently connected players from ``ARKM_sessions``,
    joined with player names and server metadata.
    """
    where = ""
    params: dict = {}
    if server_key:
        where = "WHERE s.server_key = :sk"
        params["sk"] = server_key

    result = await db.execute(
        text(
            f"SELECT s.eos_id, s.server_key, s.login_time, s.last_heartbeat, "
            f"s.ip_address, "
            f"COALESCE(NULLIF(h.player_name, ''), p.Giocatore) AS player_name, "
            f"srv.display_name, srv.map_name, "
            f"TIMESTAMPDIFF(MINUTE, s.login_time, NOW()) AS duration_min "
            f"FROM ARKM_sessions s "
            f"LEFT JOIN ARKM_players h ON s.eos_id = h.eos_id "
            f"LEFT JOIN Players p ON s.eos_id = p.EOS_Id "
            f"LEFT JOIN ARKM_servers srv ON s.server_key = srv.server_key "
            f"{where} "
            f"ORDER BY srv.display_name, player_name"
        ),
        params,
    )
    players = [
        {
            "eos_id":         r[0],
            "server_key":     r[1],
            "login_time":     str(r[2]) if r[2] else None,
            "last_heartbeat": str(r[3]) if r[3] else None,
            "ip_address":     r[4],
            "player_name":    r[5] or None,
            "server_name":    r[6],
            "map_name":       r[7],
            "duration_min":   r[8],
        }
        for r in result.fetchall()
    ]

    srv_result = await db.execute(
        text(
            "SELECT srv.server_key, srv.display_name, srv.map_name, srv.is_online, "
            "srv.player_count, srv.max_players, COUNT(s.eos_id) AS session_count "
            "FROM ARKM_servers srv "
            "LEFT JOIN ARKM_sessions s ON srv.server_key = s.server_key "
            "GROUP BY srv.server_key ORDER BY srv.display_name"
        )
    )
    servers = [
        {
            "server_key":    r[0],
            "display_name":  r[1],
            "map_name":      r[2],
            "is_online":     bool(r[3]),
            "player_count":  r[4],
            "max_players":   r[5],
            "session_count": r[6],
        }
        for r in srv_result.fetchall()
    ]

    return {
        "players":        players,
        "total_online":   len(players),
        "servers":        servers,
        "servers_online": sum(1 for s in servers if s["is_online"]),
    }


# ── Event log (read-only) ──────────────────────────────────────────────────────

@router.get("/events")
async def list_events(
    event_type: Optional[str] = Query(None, description="Filter by event type"),
    server_key: Optional[str] = Query(None, description="Filter by server key"),
    search: Optional[str] = Query(None, description="Search in player_name or details"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    Paginated read-only view of ``ARKM_event_log``.

    Supports filtering by event type, server key, and free-text search across
    player name and details.  Results are always sorted newest-first.
    """
    where_clauses: list[str] = []
    params: dict = {"lim": limit, "off": offset}

    if event_type:
        where_clauses.append("event_type = :et")
        params["et"] = event_type
    if server_key:
        where_clauses.append("server_key = :sk")
        params["sk"] = server_key
    if search:
        where_clauses.append("(player_name LIKE :q OR details LIKE :q)")
        params["q"] = f"%{search}%"

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    # Total count for pagination
    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM ARKM_event_log {where_sql}"), params
    )
    total = count_result.scalar() or 0

    # Fetch page
    result = await db.execute(
        text(
            f"SELECT id, event_type, eos_id, player_name, server_key, "
            f"details, event_time, discord_sent "
            f"FROM ARKM_event_log {where_sql} "
            f"ORDER BY event_time DESC LIMIT :lim OFFSET :off"
        ),
        params,
    )
    events = [
        {
            "id":           r[0],
            "event_type":   r[1],
            "eos_id":       r[2] or None,
            "player_name":  r[3] or None,
            "server_key":   r[4],
            "details":      r[5],
            "event_time":   str(r[6]) if r[6] else None,
            "discord_sent": bool(r[7]),
        }
        for r in result.fetchall()
    ]
    return {"events": events, "total": total, "limit": limit, "offset": offset}


@router.get("/events/stats")
async def event_stats(db: AsyncSession = Depends(get_plugin_db)):
    """
    Aggregate event counts grouped by type, plus the most recent event
    timestamp.  Used by the Event Log page header cards.
    """
    result = await db.execute(
        text(
            "SELECT event_type, COUNT(*) AS cnt, MAX(event_time) AS latest "
            "FROM ARKM_event_log GROUP BY event_type ORDER BY cnt DESC"
        )
    )
    stats = [
        {"event_type": r[0], "count": r[1], "latest": str(r[2]) if r[2] else None}
        for r in result.fetchall()
    ]
    total = sum(s["count"] for s in stats)
    return {"stats": stats, "total": total}


@router.delete("/events")
async def purge_events(
    keep_days: int = Query(..., ge=0, le=365, description="Delete events older than N days (0 = delete ALL)"),
    event_type: Optional[str] = Query(None, description="Limit purge to a specific event type"),
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    Delete events older than ``keep_days`` from ``ARKM_event_log``.

    Optionally restricts the purge to a single event type (e.g. only
    RARE_SPAWN).  Returns the number of rows deleted.
    """
    # keep_days=0 means delete everything (no date filter)
    if keep_days > 0:
        where = "WHERE event_time < DATE_SUB(NOW(), INTERVAL :days DAY)"
        params: dict = {"days": keep_days}
    else:
        where = "WHERE 1=1"
        params = {}

    if event_type:
        where += " AND event_type = :et"
        params["et"] = event_type

    result = await db.execute(
        text(f"DELETE FROM ARKM_event_log {where}"), params
    )
    deleted = result.rowcount
    return {"deleted": deleted, "keep_days": keep_days, "event_type": event_type}
