"""
api/routes/audit_log.py — Read access to the security audit trail (NIS2).

Single endpoint, admin only:

    GET /audit  — paginated list of arkmaniagest_audit_log rows,
                  newest first, with optional action/username filters.

Writes happen exclusively through :func:`app.core.audit.audit_event`;
there is deliberately no API to edit or delete individual entries
(tamper resistance) — rows age out via the retention job.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.db.session import get_db

router = APIRouter()


class AuditEntry(BaseModel):
    id: int
    username: Optional[str] = None
    action: str
    detail: Optional[str] = None
    ip_address: Optional[str] = None
    created_at: Optional[str] = None


class AuditPage(BaseModel):
    items: list[AuditEntry]
    total: int


@router.get("", response_model=AuditPage)
async def list_audit_entries(
    action: Optional[str] = Query(default=None, max_length=64),
    username: Optional[str] = Query(default=None, max_length=64),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return audit entries, newest first (admin only)."""
    where = []
    params: dict = {"limit": limit, "offset": offset}
    if action:
        where.append("action = :action")
        params["action"] = action
    if username:
        where.append("username = :username")
        params["username"] = username
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = int((await db.execute(
        text(f"SELECT COUNT(*) FROM arkmaniagest_audit_log {where_sql}"),
        params,
    )).scalar() or 0)

    rows = (await db.execute(
        text(
            "SELECT id, username, action, detail, ip_address, created_at "
            f"FROM arkmaniagest_audit_log {where_sql} "
            "ORDER BY id DESC LIMIT :limit OFFSET :offset"
        ),
        params,
    )).mappings().fetchall()

    items = [
        AuditEntry(
            id=int(r["id"]),
            username=r.get("username"),
            action=r["action"],
            detail=r.get("detail"),
            ip_address=r.get("ip_address"),
            created_at=(r["created_at"].isoformat()
                        if r.get("created_at") and hasattr(r["created_at"], "isoformat")
                        else None),
        )
        for r in rows
    ]
    return AuditPage(items=items, total=total)
