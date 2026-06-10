"""
services/retention.py — GDPR data-retention job.

Purges panel-owned history tables once per day so personal data
(usernames, source IPs) is not kept beyond the configured horizon:

  * ``arkmaniagest_audit_log``   — security audit trail
  * ``ARKM_instance_actions``    — server-instance action history

The horizon is ``DATA_RETENTION_DAYS`` from .env (default 365; 0
disables purging).  Plugin-DB tables (ARKM_sessions, ARKM_event_log, …)
are owned by the game plugins and are intentionally NOT touched here —
their retention is documented in docs/COMPLIANCE.md and managed via the
existing manual purge endpoints.

Started from the FastAPI lifespan as a background asyncio task; runs
once at boot and then every 24 hours.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import text

log = logging.getLogger("arkmaniagest.retention")

_PURGE_INTERVAL_S = 24 * 3600

# Panel-owned tables with their timestamp column.  Plugin tables must
# never appear here (two-databases rule).
_PANEL_TABLES = (
    ("arkmaniagest_audit_log", "created_at"),
    ("ARKM_instance_actions", "started_at"),
)


async def purge_expired_rows() -> None:
    """Run one purge pass.  No-op when retention is disabled."""
    from app.core.config import server_settings
    from app.db import session as db_session

    days = int(server_settings.DATA_RETENTION_DAYS or 0)
    if days <= 0:
        return
    if db_session._async_session is None:
        return

    async with db_session._async_session() as session:
        for table, ts_col in _PANEL_TABLES:
            try:
                res = await session.execute(
                    text(
                        f"DELETE FROM {table} "
                        f"WHERE {ts_col} < DATE_SUB(NOW(), INTERVAL :d DAY)"
                    ),
                    {"d": days},
                )
                await session.commit()
                if res.rowcount:
                    log.info(
                        "Retention purge: %s rows older than %s days removed from %s",
                        res.rowcount, days, table,
                    )
            except Exception as exc:  # noqa: BLE001
                await session.rollback()
                log.warning("Retention purge of %s failed: %s", table, exc)


async def retention_loop() -> None:
    """Daily purge loop; cancelled on application shutdown."""
    while True:
        await purge_expired_rows()
        await asyncio.sleep(_PURGE_INTERVAL_S)
