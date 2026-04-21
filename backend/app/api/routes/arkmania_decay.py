"""
api/routes/ARKM_decay.py — Tribe decay management.

Reads from the ``ARKM_tribe_decay``, ``ARKM_decay_pending``, and
``ARKM_decay_log`` tables (all populated by the ArkMania plugin).
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.db.session import get_db

router = APIRouter()


# NOTE: routes use "" (no trailing slash) to be consistent with
# redirect_slashes=False set in main.py.

@router.get("")
async def get_decay_overview(db: AsyncSession = Depends(get_db)):
    """
    Return aggregate decay statistics.

    Counts tribes by status (expired / expiring within 3 days / safe) plus
    the number of pending-purge entries and recent purge log entries.
    """
    stats_result = await db.execute(
        text(
            "SELECT "
            "  COUNT(*) AS total, "
            "  SUM(CASE WHEN expire_time < NOW() THEN 1 ELSE 0 END) AS expired, "
            "  SUM(CASE WHEN expire_time >= NOW() "
            "           AND expire_time < DATE_ADD(NOW(), INTERVAL 3 DAY) "
            "      THEN 1 ELSE 0 END) AS expiring_soon, "
            "  SUM(CASE WHEN expire_time >= DATE_ADD(NOW(), INTERVAL 3 DAY) "
            "      THEN 1 ELSE 0 END) AS safe "
            "FROM ARKM_tribe_decay"
        )
    )
    s = stats_result.fetchone()
    stats = {
        "total":         s[0] or 0,
        "expired":       s[1] or 0,
        "expiring_soon": s[2] or 0,
        "safe":          s[3] or 0,
    }

    pending_result = await db.execute(
        text("SELECT COUNT(*) FROM ARKM_decay_pending")
    )
    stats["pending"] = pending_result.scalar() or 0

    log_result = await db.execute(
        text(
            "SELECT COUNT(*) FROM ARKM_decay_log "
            "WHERE purged_at > DATE_SUB(NOW(), INTERVAL 7 DAY)"
        )
    )
    stats["purged_last_7d"] = log_result.scalar() or 0

    return stats


@router.get("/tribes")
async def list_decay_tribes(
    status: Optional[str] = Query(
        None, description="expired | expiring | safe | all"
    ),
    search: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
):
    """
    List tribes with their decay status.

    Args:
        status: Filter by decay status (expired / expiring / safe).
        search: Substring match against tribe name or player name/EOS-ID.
                Note: ``targeting_team`` is an INT column so it is excluded
                from LIKE matching; use exact numeric search elsewhere.
        limit:  Maximum rows returned (capped at 500).
    """
    where: list[str] = []
    params: dict = {"lim": limit}

    if status == "expired":
        where.append("d.expire_time < NOW()")
    elif status == "expiring":
        where.append(
            "d.expire_time >= NOW() "
            "AND d.expire_time < DATE_ADD(NOW(), INTERVAL 3 DAY)"
        )
    elif status == "safe":
        where.append("d.expire_time >= DATE_ADD(NOW(), INTERVAL 3 DAY)")

    if search:
        # targeting_team is INT — LIKE on INT requires an implicit cast and
        # is semantically incorrect; use separate equality check instead.
        where.append(
            "(d.tribe_name LIKE :q "
            "OR d.last_refresh_name LIKE :q "
            "OR d.last_refresh_eos LIKE :q "
            "OR p.Giocatore LIKE :q "
            "OR h.player_name LIKE :q)"
        )
        params["q"] = f"%{search}%"

    where_clause = "WHERE " + " AND ".join(where) if where else ""

    # Column indices:
    # 0=targeting_team  1=expire_time       2=last_refresh_eos
    # 3=tribe_name      4=last_refresh_name 5=last_refresh_group
    # 6=last_refresh_days 7=last_refresh_time 8=hours_left  9=player_name
    result = await db.execute(
        text(
            f"SELECT d.targeting_team, d.expire_time, d.last_refresh_eos, "
            f"d.tribe_name, d.last_refresh_name, "
            f"d.last_refresh_group, d.last_refresh_days, "
            f"d.last_refresh_time, "
            f"TIMESTAMPDIFF(HOUR, NOW(), d.expire_time) AS hours_left, "
            f"COALESCE(NULLIF(p.Giocatore, ''), h.player_name) AS player_name "
            f"FROM ARKM_tribe_decay d "
            f"LEFT JOIN Players p ON d.last_refresh_eos = p.EOS_Id "
            f"LEFT JOIN ARKM_players h ON d.last_refresh_eos = h.eos_id "
            f"{where_clause} "
            f"ORDER BY d.expire_time ASC LIMIT :lim"
        ),
        params,
    )

    tribes = []
    for r in result.fetchall():
        hours_left = r[8] or 0
        if hours_left < 0:
            status_label = "expired"
        elif hours_left < 72:
            status_label = "expiring"
        else:
            status_label = "safe"

        # Tribe name: use d.tribe_name (real name), not d.last_refresh_name (player name)
        raw_tribe = (r[3] or "").strip()
        tribes.append({
            "targeting_team":     r[0],
            "expire_time":        str(r[1]) if r[1] else None,
            "last_refresh_eos":   r[2],
            "tribe_name":         raw_tribe or None,
            "player_name":        r[9] or None,
            "last_refresh_group": r[5],
            "last_refresh_days":  r[6],
            "last_refresh_time":  str(r[7]) if r[7] else None,
            "hours_left":         hours_left,
            "status":             status_label,
        })

    return {"tribes": tribes, "count": len(tribes)}


@router.get("/pending")
async def list_pending(db: AsyncSession = Depends(get_db)):
    """List tribes flagged as pending purge, with structure and dino counts."""
    result = await db.execute(
        text(
            "SELECT p.targeting_team, p.server_key, p.reason, "
            "p.structure_count, p.dino_count, p.flagged_at, "
            "s.display_name, d.tribe_name, d.last_refresh_group, "
            "d.expire_time, "
            "COALESCE(NULLIF(pl.Giocatore, ''), h.player_name) AS player_name "
            "FROM ARKM_decay_pending p "
            "LEFT JOIN ARKM_servers s ON p.server_key = s.server_key "
            "LEFT JOIN ARKM_tribe_decay d ON p.targeting_team = d.targeting_team "
            "LEFT JOIN Players pl ON d.last_refresh_eos = pl.EOS_Id "
            "LEFT JOIN ARKM_players h ON d.last_refresh_eos = h.eos_id "
            "ORDER BY p.structure_count DESC, p.flagged_at DESC"
        )
    )
    items = []
    for r in result.fetchall():
        raw_tribe = (r[7] or "").strip()
        items.append({
            "targeting_team":     r[0],
            "server_key":         r[1],
            "reason":             r[2],
            "structure_count":    r[3],
            "dino_count":         r[4],
            "flagged_at":         str(r[5]) if r[5] else None,
            "server_name":        r[6] or r[1].split("_")[0],
            "tribe_name":         raw_tribe or None,
            "player_name":        r[10] or None,
            "last_refresh_group": r[8] or None,
            "expire_time":        str(r[9]) if r[9] else None,
        })
    return {"pending": items, "count": len(items)}


@router.get("/log")
async def list_decay_log(
    limit: int = Query(50, le=200),
    server_key: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Return the most recent tribe purge log entries."""
    where = ""
    params: dict = {"lim": limit}
    if server_key:
        where = "WHERE l.server_key = :sk"
        params["sk"] = server_key

    result = await db.execute(
        text(
            f"SELECT l.id, l.targeting_team, l.server_key, l.map_name, l.reason, "
            f"l.structures_destroyed, l.dinos_destroyed, l.purged_by, l.purged_at "
            f"FROM ARKM_decay_log l {where} "
            f"ORDER BY l.purged_at DESC LIMIT :lim"
        ),
        params,
    )
    items = [
        {
            "id":                   r[0],
            "targeting_team":       r[1],
            "server_key":           r[2],
            "map_name":             r[3],
            "reason":               r[4],
            "structures_destroyed": r[5],
            "dinos_destroyed":      r[6],
            "purged_by":            r[7],
            "purged_at":            str(r[8]) if r[8] else None,
        }
        for r in result.fetchall()
    ]
    return {"log": items, "count": len(items)}
