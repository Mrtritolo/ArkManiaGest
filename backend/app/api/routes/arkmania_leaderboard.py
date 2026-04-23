"""
api/routes/ARKM_leaderboard.py — Player leaderboard data.

Reads from the ``ARKM_lb_scores`` and ``ARKM_lb_events`` tables,
both populated in real-time by the ArkMania plugin.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.db.session import get_plugin_db

router = APIRouter()

# Human-readable labels for event type IDs stored in ARKM_lb_events.event_type
EVENT_TYPES: dict[int, str] = {
    1: "Kill Wild",
    2: "Kill Enemy Dino",
    3: "Kill Player",
    4: "Tame",
    5: "Craft",
    6: "Struct Destroyed",
    7: "Death",
}

# Columns allowed as sort keys for list_scores — enforced server-side to
# prevent SQL injection via the sort_by query parameter.
_ALLOWED_SORT_COLUMNS: frozenset[str] = frozenset({
    "total_points", "kills_wild", "kills_enemy_dino", "kills_player",
    "tames", "crafts", "structs_destroyed", "deaths",
})


# NOTE: routes use "" (no trailing slash) to be consistent with
# redirect_slashes=False set in main.py.

@router.get("")
async def leaderboard_overview(db: AsyncSession = Depends(get_plugin_db)):
    """Return global aggregate statistics for the leaderboard dashboard."""
    stats = await db.execute(
        text(
            "SELECT "
            "  COUNT(DISTINCT eos_id)            AS total_players, "
            "  COALESCE(SUM(total_points), 0)    AS total_points, "
            "  COALESCE(SUM(kills_wild), 0)      AS total_kills_wild, "
            "  COALESCE(SUM(kills_enemy_dino),0) AS total_kills_enemy_dino, "
            "  COALESCE(SUM(kills_player), 0)    AS total_kills_player, "
            "  COALESCE(SUM(tames), 0)           AS total_tames, "
            "  COALESCE(SUM(crafts), 0)          AS total_crafts, "
            "  COALESCE(SUM(deaths), 0)          AS total_deaths "
            "FROM ARKM_lb_scores"
        )
    )
    s = stats.fetchone()

    events_result = await db.execute(text("SELECT COUNT(*) FROM ARKM_lb_events"))
    total_events  = events_result.scalar() or 0

    return {
        "total_players":          s[0] or 0,
        "total_points":           s[1] or 0,
        "total_kills_wild":       s[2] or 0,
        "total_kills_enemy_dino": s[3] or 0,
        "total_kills_player":     s[4] or 0,
        "total_tames":            s[5] or 0,
        "total_crafts":           s[6] or 0,
        "total_deaths":           s[7] or 0,
        "total_events":           total_events,
    }


@router.get("/scores")
async def list_scores(
    server_type: Optional[str] = Query(None, description="PvE or PvP"),
    sort_by: str = Query("total_points", description="Column to sort by"),
    limit:   int = Query(50, le=200),
    offset:  int = Query(0, ge=0),
    search:  Optional[str] = Query(None),
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    Return ranked player scores.

    Args:
        server_type: Filter to ``PvE`` or ``PvP`` scores only.
        sort_by:     Column to sort by (validated against an allowlist).
        limit:       Rows per page (max 200).
        offset:      Pagination offset.
        search:      Substring match against player name.
    """
    # Validate and sanitise the sort column (never interpolate raw user input into SQL)
    if sort_by not in _ALLOWED_SORT_COLUMNS:
        sort_by = "total_points"

    where:  list[str] = []
    params: dict      = {"lim": limit, "off": offset}

    if server_type:
        where.append("server_type = :stype")
        params["stype"] = server_type
    if search:
        where.append("player_name LIKE :q")
        params["q"] = f"%{search}%"

    where_clause = "WHERE " + " AND ".join(where) if where else ""

    count_result = await db.execute(
        text(f"SELECT COUNT(DISTINCT eos_id) FROM ARKM_lb_scores {where_clause}"),
        params,
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        text(
            f"SELECT eos_id, player_name, server_type, total_points, "
            f"kills_wild, kills_enemy_dino, kills_player, tames, crafts, "
            f"structs_destroyed, deaths, last_event "
            f"FROM ARKM_lb_scores {where_clause} "
            f"ORDER BY {sort_by} DESC, total_points DESC "
            f"LIMIT :lim OFFSET :off"
        ),
        params,
    )

    scores = []
    rank = offset + 1
    for r in result.fetchall():
        scores.append({
            "rank":              rank,
            "eos_id":            r[0],
            "player_name":       r[1],
            "server_type":       r[2],
            "total_points":      r[3],
            "kills_wild":        r[4],
            "kills_enemy_dino":  r[5],
            "kills_player":      r[6],
            "tames":             r[7],
            "crafts":            r[8],
            "structs_destroyed": r[9],
            "deaths":            r[10],
            "last_event":        str(r[11]) if r[11] else None,
        })
        rank += 1

    return {"scores": scores, "total": total}


@router.get("/events")
async def list_events(
    server_type: Optional[str] = Query(None),
    event_type:  Optional[int] = Query(None),
    eos_id:      Optional[str] = Query(None),
    limit:       int = Query(50, le=200),
    db: AsyncSession = Depends(get_plugin_db),
):
    """Return recent leaderboard events with optional filters."""
    where:  list[str] = []
    params: dict      = {"lim": limit}

    if server_type:
        where.append("server_type = :stype")
        params["stype"] = server_type
    if event_type is not None:
        where.append("event_type = :etype")
        params["etype"] = event_type
    if eos_id:
        where.append("eos_id = :eos")
        params["eos"] = eos_id

    where_clause = "WHERE " + " AND ".join(where) if where else ""

    result = await db.execute(
        text(
            f"SELECT id, eos_id, player_name, event_type, points, "
            f"target_class, target_name, target_level, target_team, "
            f"server_key, server_type, created_at "
            f"FROM ARKM_lb_events {where_clause} "
            f"ORDER BY created_at DESC LIMIT :lim"
        ),
        params,
    )

    events = [
        {
            "id":           r[0],
            "eos_id":       r[1],
            "player_name":  r[2],
            "event_type":   r[3],
            "event_label":  EVENT_TYPES.get(r[3], f"Type {r[3]}"),
            "points":       r[4],
            "target_class": r[5] or None,
            "target_name":  r[6] or None,
            "target_level": r[7] or 0,
            "target_team":  r[8] or 0,
            "server_key":   r[9],
            "server_type":  r[10],
            "created_at":   str(r[11]) if r[11] else None,
        }
        for r in result.fetchall()
    ]
    return {"events": events, "count": len(events)}


# NOTE: this DELETE must stay declared BEFORE any `/{eos_id}` route below
# (FastAPI matches paths in declaration order, so a catch-all DELETE
# would intercept `/scores`).  Today only GET /player/{eos_id} exists,
# but keeping the order explicit prevents future surprises.
@router.delete("/scores")
async def clear_leaderboard(
    server_type: Optional[str] = Query(
        default=None,
        description=(
            "Wipe only PvE or PvP rows.  Omit to clear EVERY leaderboard "
            "score + every event row regardless of server type."
        ),
    ),
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    Wipe the leaderboard for a given server type (or all of them).

    Truncates BOTH the aggregate score table (``ARKM_lb_scores``) and
    the per-event log (``ARKM_lb_events``) for the matching ``server_type``,
    so the dashboard tiles + the recent-events widget go back to zero in
    lockstep.  Use cases:

    * end of season -> wipe PvP only, keep PvE history;
    * map / cluster wipe -> drop everything by omitting ``server_type``.

    Returns the row counts deleted from each table so the UI can show a
    confirmation toast.
    """
    where: list[str] = []
    params: dict     = {}
    if server_type:
        # Plugin uses the literal strings 'PvE' / 'PvP' (case-sensitive in
        # MariaDB depending on collation), so we don't normalise here.
        where.append("server_type = :stype")
        params["stype"] = server_type

    where_clause = ("WHERE " + " AND ".join(where)) if where else ""

    scores_res = await db.execute(
        text(f"DELETE FROM ARKM_lb_scores {where_clause}"), params,
    )
    events_res = await db.execute(
        text(f"DELETE FROM ARKM_lb_events {where_clause}"), params,
    )
    await db.commit()

    return {
        "scores_deleted": scores_res.rowcount,
        "events_deleted": events_res.rowcount,
        "scope":          server_type or "all",
    }


@router.get("/player/{eos_id}")
async def get_player_leaderboard(eos_id: str, db: AsyncSession = Depends(get_plugin_db)):
    """Return all scores and the most recent 50 events for a single player."""
    scores_result = await db.execute(
        text("SELECT * FROM ARKM_lb_scores WHERE eos_id = :eos"),
        {"eos": eos_id},
    )
    scores = [dict(r) for r in scores_result.mappings().fetchall()]

    events_result = await db.execute(
        text(
            "SELECT id, event_type, points, target_name, target_level, "
            "server_key, server_type, created_at "
            "FROM ARKM_lb_events WHERE eos_id = :eos "
            "ORDER BY created_at DESC LIMIT 50"
        ),
        {"eos": eos_id},
    )
    events = [
        {
            "id":           r[0],
            "event_type":   r[1],
            "event_label":  EVENT_TYPES.get(r[1], f"Type {r[1]}"),
            "points":       r[2],
            "target_name":  r[3],
            "target_level": r[4],
            "server_key":   r[5],
            "server_type":  r[6],
            "created_at":   str(r[7]) if r[7] else None,
        }
        for r in events_result.fetchall()
    ]
    return {"scores": scores, "events": events}
