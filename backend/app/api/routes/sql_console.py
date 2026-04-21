"""
api/routes/sql_console.py — SQL Console endpoints for direct database interaction.

Provides a full SQL console accessible exclusively to admin users.  All queries
are executed via a dedicated aiomysql connection to avoid interfering with the
application's SQLAlchemy session lifecycle.

Endpoints:
    POST /sql/execute              — Execute an arbitrary SQL query
    GET  /sql/tables               — List all tables in the configured database
    GET  /sql/tables/{name}/schema — Column metadata for a specific table

Security:
    Every endpoint requires the ``admin`` role.  No query filtering or
    sanitisation is applied — the admin is assumed to know what they are doing.
    A maximum execution timeout of 30 seconds is enforced to prevent runaway
    queries from exhausting the connection pool.
"""
import time
import logging
from typing import Any
from datetime import date, datetime, timedelta
from decimal import Decimal

import aiomysql
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import require_admin
from app.core.config import server_settings
from app.schemas.sql_console import (
    SqlExecuteRequest,
    SqlExecuteResult,
    TableInfo,
    ColumnInfo,
)

router = APIRouter()
log = logging.getLogger("arkmaniagest.sql_console")

# Maximum query execution time in seconds (prevents runaway queries)
_QUERY_TIMEOUT_SECONDS = 30


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_connection() -> aiomysql.Connection:
    """
    Open a short-lived aiomysql connection using the app's .env credentials.

    This is intentionally separate from the SQLAlchemy engine so that raw
    DDL/DML statements do not interfere with the ORM session management.

    Raises:
        HTTPException 500: Database credentials are not configured.
    """
    s = server_settings
    if not s.DB_PASSWORD:
        raise HTTPException(
            status_code=500,
            detail="Database credentials are not configured in .env.",
        )

    try:
        conn = await aiomysql.connect(
            host=s.DB_HOST,
            port=s.DB_PORT,
            user=s.DB_USER,
            password=s.DB_PASSWORD,
            db=s.DB_NAME,
            connect_timeout=10,
            autocommit=True,
        )
        return conn
    except Exception as exc:
        log.error("SQL Console: connection failed — %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Database connection failed: {exc}",
        )


def _serialise_value(value: Any) -> Any:
    """
    Convert non-JSON-serialisable types to their string/numeric representation.

    Handles the common MariaDB types that json.dumps cannot serialise directly:
    datetime, date, timedelta, Decimal, bytes, and memoryview.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, timedelta):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (bytes, bytearray)):
        # Attempt UTF-8 decode; fall back to hex representation
        try:
            return value.decode("utf-8")
        except (UnicodeDecodeError, AttributeError):
            return value.hex()
    if isinstance(value, memoryview):
        return bytes(value).hex()
    return value


def _serialise_row(row: tuple) -> list[Any]:
    """Apply :func:`_serialise_value` to every cell in a result row."""
    return [_serialise_value(cell) for cell in row]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/execute", response_model=SqlExecuteResult)
async def execute_query(
    req: SqlExecuteRequest,
    _admin: dict = Depends(require_admin),
):
    """
    Execute an arbitrary SQL query against the configured MariaDB database.

    Both read (SELECT / SHOW / DESCRIBE / EXPLAIN) and write (INSERT / UPDATE /
    DELETE / DDL) statements are supported.  The query runs with autocommit
    enabled and a configurable timeout.

    Returns:
        :class:`SqlExecuteResult` containing columns, rows, timing, and
        an informational message for non-SELECT statements.
    """
    query_text = req.query.strip()
    if not query_text:
        return SqlExecuteResult(
            success=False,
            query=req.query,
            error="Empty query.",
        )

    conn: aiomysql.Connection | None = None
    try:
        conn = await _get_connection()

        async with conn.cursor() as cur:
            # Enforce a per-query execution timeout.
            # MariaDB uses max_statement_time (in seconds), not MySQL's
            # max_execution_time (which uses milliseconds).
            await cur.execute(
                f"SET SESSION max_statement_time = {_QUERY_TIMEOUT_SECONDS}"
            )

            start = time.perf_counter()
            # When no parameters are provided, call execute() without the
            # params argument.  Passing an empty tuple causes aiomysql to
            # apply %-formatting to the query string, which breaks LIKE
            # patterns containing literal '%' characters (e.g. '%Item%').
            if req.params:
                await cur.execute(query_text, req.params)
            else:
                await cur.execute(query_text)
            elapsed_ms = (time.perf_counter() - start) * 1000

            # Determine whether the query produced a result set
            if cur.description:
                # SELECT / SHOW / DESCRIBE / EXPLAIN — return rows
                columns = [col[0] for col in cur.description]
                raw_rows = await cur.fetchall()
                rows = [_serialise_row(r) for r in raw_rows]
                row_count = len(rows)
                message = f"{row_count} row{'s' if row_count != 1 else ''} returned"
            else:
                # DML / DDL — no result set
                columns = []
                rows = []
                row_count = cur.rowcount
                message = f"{row_count} row{'s' if row_count != 1 else ''} affected"

        log.info(
            "SQL Console [%s]: %.1f ms — %s",
            _admin.get("sub", "admin"),
            elapsed_ms,
            message,
        )

        return SqlExecuteResult(
            success=True,
            query=req.query,
            columns=columns,
            rows=rows,
            row_count=row_count,
            execution_time_ms=round(elapsed_ms, 2),
            message=message,
        )

    except Exception as exc:
        log.warning("SQL Console error: %s", exc)
        return SqlExecuteResult(
            success=False,
            query=req.query,
            error=str(exc),
        )

    finally:
        if conn:
            conn.close()


@router.get("/tables", response_model=list[TableInfo])
async def list_tables(_admin: dict = Depends(require_admin)):
    """
    List all tables in the configured database with basic size information.

    Reads from ``information_schema.TABLES`` to avoid running raw SHOW
    statements, which ensures consistent column names across MariaDB versions.
    """
    conn: aiomysql.Connection | None = None
    try:
        conn = await _get_connection()
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT
                    TABLE_NAME,
                    ENGINE,
                    TABLE_ROWS,
                    ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024, 1) AS data_size_kb,
                    TABLE_COMMENT
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = %s
                ORDER BY TABLE_NAME
                """,
                (server_settings.DB_NAME,),
            )
            rows = await cur.fetchall()

        return [
            TableInfo(
                name=row[0],
                engine=row[1],
                row_count=row[2],
                data_size_kb=float(row[3]) if row[3] else None,
                comment=row[4] if row[4] else None,
            )
            for row in rows
        ]

    except Exception as exc:
        log.error("SQL Console: table listing failed — %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    finally:
        if conn:
            conn.close()


@router.get("/tables/{table_name}/schema", response_model=list[ColumnInfo])
async def get_table_schema(
    table_name: str,
    _admin: dict = Depends(require_admin),
):
    """
    Return column-level metadata for the specified table.

    Uses ``information_schema.COLUMNS`` to retrieve type, nullability, key
    info, defaults, and auto-increment status.
    """
    conn: aiomysql.Connection | None = None
    try:
        conn = await _get_connection()
        async with conn.cursor() as cur:
            await cur.execute(
                """
                SELECT
                    COLUMN_NAME,
                    COLUMN_TYPE,
                    IS_NULLABLE,
                    COLUMN_DEFAULT,
                    COLUMN_KEY,
                    EXTRA,
                    COLUMN_COMMENT
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                ORDER BY ORDINAL_POSITION
                """,
                (server_settings.DB_NAME, table_name),
            )
            rows = await cur.fetchall()

        if not rows:
            raise HTTPException(
                status_code=404,
                detail=f"Table '{table_name}' not found in database "
                       f"'{server_settings.DB_NAME}'.",
            )

        return [
            ColumnInfo(
                name=row[0],
                data_type=row[1],
                is_nullable=(row[2] == "YES"),
                column_default=row[3],
                column_key=row[4] if row[4] else None,
                extra=row[5] if row[5] else None,
                comment=row[6] if row[6] else None,
            )
            for row in rows
        ]

    except HTTPException:
        raise
    except Exception as exc:
        log.error("SQL Console: schema query failed — %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    finally:
        if conn:
            conn.close()
