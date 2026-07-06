"""
core/audit.py — Security audit-trail helper (NIS2).

One write path for every panel-level security event so the call sites
stay one-liners and the no-sensitive-data rule is enforced in a single
place.  Events land in ``arkmaniagest_audit_log`` (panel DB) and are
purged by the retention job after ``DATA_RETENTION_DAYS``.

Never pass passwords, tokens or raw query bodies through ``detail``.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import _extract_client_ip

log = logging.getLogger("arkmaniagest.audit")


async def audit_event(
    db: AsyncSession,
    *,
    action: str,
    username: Optional[str] = None,
    detail: Optional[str] = None,
    request: Optional[Request] = None,
) -> None:
    """
    Record one audit event.  Best-effort: a failed insert is logged and
    swallowed so the audit trail can never break the business operation
    it documents (the DB write that matters has its own transaction).
    """
    ip = None
    if request is not None:
        try:
            ip = _extract_client_ip(request)
        except Exception:  # noqa: BLE001
            ip = None
    try:
        # SAVEPOINT so a failed INSERT (e.g. missing audit table) rolls
        # back only itself: a plain failure would leave the shared
        # request session in a deactivated-transaction state and the
        # route's final commit would raise PendingRollbackError, turning
        # a successful business operation into a 500 — and a full
        # session rollback would silently discard the caller's own
        # uncommitted work.
        async with db.begin_nested():
            await db.execute(
                text(
                    "INSERT INTO arkmaniagest_audit_log "
                    "(username, action, detail, ip_address) "
                    "VALUES (:u, :a, :d, :ip)"
                ),
                {
                    "u": (username or None) and str(username)[:64],
                    "a": str(action)[:64],
                    "d": (detail or None) and str(detail)[:512],
                    "ip": (ip or None) and str(ip)[:45],
                },
            )
    except Exception as exc:  # noqa: BLE001
        log.warning("audit_event(%s) insert failed: %s", action, exc)
        return
    try:
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        log.warning("audit_event(%s) commit failed: %s", action, exc)
        try:
            await db.rollback()
        except Exception:  # noqa: BLE001
            pass
