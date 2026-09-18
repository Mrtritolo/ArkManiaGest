"""
api/routes/ARKM_bans.py — Cluster-wide ban management.

Reads from and writes to the ``ARKM_bans`` table.
Bans can be permanent or time-limited; inactive bans are preserved for audit.

Banning and unbanning need ``require_operator``.  ``banned_by`` /
``unbanned_by`` are the panel username from the JWT, never a value the
client sends, so the audit columns name who actually did it.
"""
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.auth import require_operator
from app.db.session import get_plugin_db

router = APIRouter()


# ── Schemas ────────────────────────────────────────────────────────────────────

class BanCreate(BaseModel):
    """Fields required to create a new ban entry."""
    eos_id:      str
    player_name: Optional[str] = None
    reason:      str = "No reason"
    # Optional expiration as a proper datetime; None means permanent ban.
    expire_time: Optional[datetime] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _row_to_ban(r) -> dict:
    """Convert a raw database row tuple to a serialisable ban dict."""
    return {
        "id":          r[0],
        "eos_id":      r[1],
        "player_name": r[2],
        "reason":      r[3],
        "banned_by":   r[4],
        "ban_time":    str(r[5]) if r[5] else None,
        "expire_time": str(r[6]) if r[6] else None,
        "is_active":   bool(r[7]),
        "unbanned_by": r[8],
        "unban_time":  str(r[9]) if r[9] else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

# NOTE: routes use "" (no trailing slash) to be consistent with
# redirect_slashes=False set in main.py.

@router.get("")
async def list_bans(
    active_only: bool = Query(True),
    search: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_plugin_db),
):
    """
    List ban entries with optional active-only filter and text search.

    Args:
        active_only: When True (default), return only active bans.
        search:      Optional substring to match against EOS ID, player name,
                     or ban reason.
        limit:       Maximum rows to return (capped at 500).
    """
    where: list[str] = []
    params: dict = {"lim": limit}

    if active_only:
        where.append("is_active = 1")
    if search:
        where.append("(eos_id LIKE :q OR player_name LIKE :q OR reason LIKE :q)")
        params["q"] = f"%{search}%"

    where_clause = "WHERE " + " AND ".join(where) if where else ""

    result = await db.execute(
        text(
            f"SELECT id, eos_id, player_name, reason, banned_by, ban_time, "
            f"expire_time, is_active, unbanned_by, unban_time "
            f"FROM ARKM_bans {where_clause} "
            f"ORDER BY ban_time DESC LIMIT :lim"
        ),
        params,
    )
    bans = [_row_to_ban(r) for r in result.fetchall()]

    count_result = await db.execute(
        text("SELECT COUNT(*) FROM ARKM_bans WHERE is_active = 1")
    )
    active_count = count_result.scalar() or 0
    # Unfiltered, like active_count: the page derives "unbanned" from both,
    # which the filtered and LIMITed list above cannot give it.
    total_count = (await db.execute(text("SELECT COUNT(*) FROM ARKM_bans"))).scalar() or 0

    return {"bans": bans, "active_count": active_count, "total_count": total_count}


@router.post("")
async def create_ban(
    body: BanCreate,
    db: AsyncSession = Depends(get_plugin_db),
    user: dict = Depends(require_operator),
):
    """Create a new active ban."""
    # The driver drops tzinfo, so an aware expiry (PlayersPage sends
    # toISOString(), i.e. UTC) was stored as UTC wall time next to a
    # ban_time taken from the DB's local NOW().  Shift it to the DB clock
    # in SQL; naive values are taken as DB-local, as before.
    expire = body.expire_time
    expire_sql = ":expire"
    if expire is not None and expire.tzinfo is not None:
        expire = expire.astimezone(timezone.utc).replace(tzinfo=None)
        expire_sql = (
            "DATE_ADD(:expire, INTERVAL "
            "TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND)"
        )
    await db.execute(
        text(
            "INSERT INTO ARKM_bans "
            "(eos_id, player_name, reason, banned_by, ban_time, expire_time, is_active) "
            f"VALUES (:eos, :pn, :reason, :by, NOW(), {expire_sql}, 1)"
        ),
        {
            "eos":    body.eos_id,
            "pn":     body.player_name,
            "reason": body.reason,
            "by":     user["sub"],
            "expire": expire,
        },
    )
    # Transaction committed by get_plugin_db dependency on success.
    return {"created": True, "eos_id": body.eos_id}


@router.put("/{ban_id}/unban")
async def unban(
    ban_id: int,
    db: AsyncSession = Depends(get_plugin_db),
    user: dict = Depends(require_operator),
):
    """
    Deactivate an active ban.

    Raises:
        HTTPException 404: Ban not found or already deactivated.
    """
    result = await db.execute(
        text(
            "UPDATE ARKM_bans "
            "SET is_active = 0, unbanned_by = :by, unban_time = NOW() "
            "WHERE id = :id AND is_active = 1"
        ),
        {"id": ban_id, "by": user["sub"]},
    )
    # Transaction committed by get_plugin_db dependency on success.
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Ban not found or already deactivated.")
    return {"unbanned": True, "ban_id": ban_id}


@router.get("/{ban_id}")
async def get_ban(ban_id: int, db: AsyncSession = Depends(get_plugin_db)):
    """Return details for a single ban entry."""
    result = await db.execute(
        text(
            "SELECT id, eos_id, player_name, reason, banned_by, ban_time, "
            "expire_time, is_active, unbanned_by, unban_time "
            "FROM ARKM_bans WHERE id = :id"
        ),
        {"id": ban_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Ban not found.")
    return _row_to_ban(row)
