"""
api/routes/ARKM_transfer_rules.py — Server-to-server transfer rule management.

Reads from and writes to the ``ARKM_transfer_rules`` table.

Transfer levels:
    0 = full               — character, inventory, and dinos
    1 = survivor_inventory — character and inventory only
    2 = survivor_only      — character only
    3 = blocked            — transfer denied
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.db.session import get_db

router = APIRouter()

# ── Level definitions ──────────────────────────────────────────────────────────
TRANSFER_LEVELS: dict[int, str] = {
    0: "full",
    1: "survivor_inventory",
    2: "survivor_only",
    3: "blocked",
}
TRANSFER_LEVEL_NAMES: dict[str, int] = {v: k for k, v in TRANSFER_LEVELS.items()}


# ── Schemas ────────────────────────────────────────────────────────────────────

class TransferRuleCreate(BaseModel):
    """Fields required to create a new transfer rule."""
    source_server:  str
    dest_server:    str
    transfer_level: int   # 0–3; see module docstring
    notes:          Optional[str] = None


class TransferRuleUpdate(BaseModel):
    """Fields that can be updated on an existing transfer rule (all optional)."""
    transfer_level: Optional[int] = None
    notes:          Optional[str] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _row_to_rule(r) -> dict:
    """Convert a raw database row tuple to a serialisable rule dict."""
    return {
        "id":                  r[0],
        "source_server":       r[1],
        "dest_server":         r[2],
        "transfer_level":      r[3],
        "transfer_level_name": TRANSFER_LEVELS.get(r[3], "unknown"),
        "notes":               r[4],
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

# NOTE: routes use "" (no trailing slash) to be consistent with
# redirect_slashes=False set in main.py.

@router.get("")
async def list_transfer_rules(db: AsyncSession = Depends(get_db)):
    """Return all transfer rules ordered by source → destination server."""
    result = await db.execute(
        text(
            "SELECT id, source_server, dest_server, transfer_level, notes "
            "FROM ARKM_transfer_rules ORDER BY source_server, dest_server"
        )
    )
    rules = [_row_to_rule(r) for r in result.fetchall()]
    return {"rules": rules, "levels": TRANSFER_LEVELS}


@router.post("")
async def create_rule(body: TransferRuleCreate, db: AsyncSession = Depends(get_db)):
    """
    Create a new transfer rule.

    Raises:
        HTTPException 400: Invalid transfer level (must be 0–3).
        HTTPException 409: A rule for this source/destination pair already exists.
    """
    if body.transfer_level not in TRANSFER_LEVELS:
        raise HTTPException(
            status_code=400,
            detail=f"transfer_level must be 0–3, received {body.transfer_level}",
        )

    try:
        await db.execute(
            text(
                "INSERT INTO ARKM_transfer_rules "
                "(source_server, dest_server, transfer_level, notes) "
                "VALUES (:src, :dst, :lv, :notes)"
            ),
            {
                "src":   body.source_server,
                "dst":   body.dest_server,
                "lv":    body.transfer_level,
                "notes": body.notes,
            },
        )
        # Transaction committed by get_db dependency on success.
    except Exception as exc:
        if "Duplicate" in str(exc):
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Rule {body.source_server} → {body.dest_server} already exists"
                ),
            )
        raise

    return {"created": True}


@router.put("/{rule_id}")
async def update_rule(
    rule_id: int,
    body: TransferRuleUpdate,
    db: AsyncSession = Depends(get_db),
):
    """
    Update an existing transfer rule.

    Raises:
        HTTPException 400: No fields to update, or invalid transfer level.
        HTTPException 404: Rule not found.
    """
    set_clauses: list[str] = []
    params: dict = {"rid": rule_id}

    if body.transfer_level is not None:
        if body.transfer_level not in TRANSFER_LEVELS:
            raise HTTPException(
                status_code=400,
                detail="transfer_level must be 0–3",
            )
        set_clauses.append("transfer_level = :lv")
        params["lv"] = body.transfer_level

    if body.notes is not None:
        set_clauses.append("notes = :notes")
        params["notes"] = body.notes

    if not set_clauses:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = await db.execute(
        text(
            f"UPDATE ARKM_transfer_rules "
            f"SET {', '.join(set_clauses)} WHERE id = :rid"
        ),
        params,
    )
    # Transaction committed by get_db dependency on success.

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"updated": True, "id": rule_id}


@router.delete("/{rule_id}")
async def delete_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    """
    Delete a transfer rule.

    Raises:
        HTTPException 404: Rule not found.
    """
    result = await db.execute(
        text("DELETE FROM ARKM_transfer_rules WHERE id = :rid"),
        {"rid": rule_id},
    )
    # Transaction committed by get_db dependency on success.
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"deleted": True, "id": rule_id}
