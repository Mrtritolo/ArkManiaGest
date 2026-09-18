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
    queries from exhausting the connection pool, and the returned result is
    capped (see ``_MAX_ROWS`` / ``_MAX_RESULT_CHARS``).

    The cap is also set server side with ``sql_select_limit``, which applies
    to every top-level SELECT without its own LIMIT, whatever its sink:
    ``SELECT ... INTO OUTFILE`` writes at most ``_MAX_ROWS + 1`` rows unless
    the statement carries an explicit LIMIT.  Only the first result set of a
    multi-statement batch is streamed; later ones are read buffered.
"""
import re
import time
import logging
from typing import Any
from datetime import date, datetime, timedelta
from decimal import Decimal

import aiomysql
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit_event
from app.core.auth import require_admin
from app.core.config import server_settings
from app.db.session import get_db
from app.schemas.sql_console import (
    DatabaseTarget,
    SqlExecuteRequest,
    SqlExecuteResult,
    TableInfo,
    ColumnInfo,
)

router = APIRouter()
log = logging.getLogger("arkmaniagest.sql_console")

# Maximum query execution time in seconds (prevents runaway queries)
_QUERY_TIMEOUT_SECONDS = 30

# Result caps.  The response is built in memory on the single uvicorn
# worker and the page renders every row, so an unbounded SELECT (or a few
# rows of MEDIUMTEXT / LONGBLOB) could stall or kill the panel for everyone.
_MAX_ROWS = 1000
_MAX_RESULT_CHARS = 8 * 1024 * 1024

# Quoted strings, quoted identifiers and comments: a ';' inside them does not
# end a statement.  Unterminated ones run to the end of the text.
_SQL_NOISE_RE = re.compile(
    r"'(?:[^'\\]|\\.)*(?:'|\\?\Z)"
    r'|"(?:[^"\\]|\\.)*(?:"|\\?\Z)'
    r"|`[^`]*(?:`|\Z)"
    r"|/\*.*?(?:\*/|\Z)"
    r"|(?:#|--(?=\s|\Z))[^\n]*",
    re.S,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _resolve_connection_params(target: DatabaseTarget) -> dict:
    """
    Return the aiomysql connection kwargs for the requested database target.

    ``plugin`` falls back to the panel DSN when no ``PLUGIN_DB_*`` variables
    are configured, so single-database deployments keep working.

    Raises:
        HTTPException 503: Target credentials are not configured.
    """
    s = server_settings
    if target == "plugin":
        password = s.plugin_db_password
        if not password:
            raise HTTPException(
                status_code=503,
                detail="Plugin database credentials are not configured in .env.",
            )
        return {
            "host": s.plugin_db_host,
            "port": s.plugin_db_port,
            "user": s.plugin_db_user,
            "password": password,
            "db": s.plugin_db_name,
        }

    if not s.DB_PASSWORD:
        raise HTTPException(
            status_code=503,
            detail="Panel database credentials are not configured in .env.",
        )
    return {
        "host": s.DB_HOST,
        "port": s.DB_PORT,
        "user": s.DB_USER,
        "password": s.DB_PASSWORD,
        "db": s.DB_NAME,
    }


async def _get_connection(target: DatabaseTarget = "panel") -> aiomysql.Connection:
    """
    Open a short-lived aiomysql connection for the requested target.

    This is intentionally separate from the SQLAlchemy engines so that raw
    DDL/DML statements do not interfere with ORM session management.

    Args:
        target: ``"panel"`` (default) or ``"plugin"``.

    Raises:
        HTTPException 503: Connection failed or credentials missing.
    """
    params = _resolve_connection_params(target)
    try:
        return await aiomysql.connect(
            **params,
            connect_timeout=10,
            autocommit=True,
        )
    except Exception as exc:
        log.error("SQL Console: connection failed [%s] — %s", target, exc)
        raise HTTPException(
            status_code=503,
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


def _statement_verbs(sql: str) -> str:
    """
    Comma-separated leading keyword of every statement in *sql*.

    Written to the audit trail, which must not store the query body.  Best
    effort only: the authoritative statement count comes from the result
    sets the server sends back.
    """
    code = _SQL_NOISE_RE.sub(" ", sql)
    return ",".join(
        part.split(None, 1)[0].upper()[:16]
        for part in code.split(";")
        if part.strip()
    ) or "?"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/execute", response_model=SqlExecuteResult)
async def execute_query(
    req: SqlExecuteRequest,
    request: Request,
    _admin: dict = Depends(require_admin),
    panel_db: AsyncSession = Depends(get_db),
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

    verbs = _statement_verbs(query_text)
    # Statements the server completed.  aiomysql always enables
    # multi-statements, and with autocommit each one is committed as soon
    # as it runs, even when a later one in the batch fails.
    statements = 0

    async def _audit(outcome: str) -> None:
        # Audit trail: record WHO ran WHICH kinds of statement against
        # WHICH database and how it ended, on success and on failure --
        # never the query body (it may embed personal data or credentials).
        await audit_event(
            panel_db, action="sql.execute",
            username=_admin.get("sub"),
            detail=(f"db={req.database} {outcome} "
                    f"statements={statements} verbs={verbs}"),
            request=request,
        )

    conn: aiomysql.Connection | None = None
    try:
        conn = await _get_connection(req.database)

        # Unbuffered cursor: the first result set is read one row at a time
        # below and capped.  aiomysql's nextset() reads every later result
        # set of a batch buffered, so those are only bounded by
        # sql_select_limit (for SELECTs without their own LIMIT).
        async with conn.cursor(aiomysql.SSCursor) as cur:
            # Enforce a per-query execution timeout.
            # MariaDB uses max_statement_time (in seconds), not MySQL's
            # max_execution_time (which uses milliseconds).
            await cur.execute(
                f"SET SESSION max_statement_time = {_QUERY_TIMEOUT_SECONDS}"
            )
            # Lets the server stop a SELECT without its own LIMIT one row
            # past the cap, instead of streaming rows we would discard.
            # Side effect: it also limits SELECT ... INTO OUTFILE, so an
            # export needs an explicit LIMIT to write more rows.
            await cur.execute(f"SET SESSION sql_select_limit = {_MAX_ROWS + 1}")

            start = time.perf_counter()
            # When no parameters are provided, call execute() without the
            # params argument.  Passing an empty tuple causes aiomysql to
            # apply %-formatting to the query string, which breaks LIKE
            # patterns containing literal '%' characters (e.g. '%Item%').
            if req.params:
                await cur.execute(query_text, req.params)
            else:
                await cur.execute(query_text)
            statements = 1

            # Determine whether the query produced a result set
            truncated = False
            if cur.description:
                # SELECT / SHOW / DESCRIBE / EXPLAIN — return rows
                columns = [col[0] for col in cur.description]
                rows = []
                size = 0
                while (raw := await cur.fetchone()) is not None:
                    if len(rows) >= _MAX_ROWS or size >= _MAX_RESULT_CHARS:
                        truncated = True
                        # Read the rest without keeping it, so the
                        # statements after this one in a batch still run.
                        while await cur.fetchone() is not None:
                            pass
                        break
                    rows.append(_serialise_row(raw))
                    size += sum(len(str(cell)) for cell in rows[-1])
                row_count = len(rows)
                message = f"{row_count} row{'s' if row_count != 1 else ''} returned"
                if truncated:
                    message += " (result truncated)"
            else:
                # DML / DDL — no result set
                columns = []
                rows = []
                row_count = cur.rowcount
                message = f"{row_count} row{'s' if row_count != 1 else ''} affected"

            # Run the rest of a multi-statement batch here, so an error in
            # a later statement is reported and audited instead of being
            # raised while the cursor closes.
            while await cur.nextset():
                statements += 1
            elapsed_ms = (time.perf_counter() - start) * 1000

        log.info(
            "SQL Console [%s/%s]: %.1f ms — %s",
            _admin.get("sub", "admin"),
            req.database,
            elapsed_ms,
            message,
        )
        await _audit(f"ok ({message})")

        return SqlExecuteResult(
            success=True,
            query=req.query,
            columns=columns,
            rows=rows,
            row_count=row_count,
            truncated=truncated,
            execution_time_ms=round(elapsed_ms, 2),
            message=message,
        )

    except Exception as exc:
        log.warning("SQL Console error: %s", exc)
        # MariaDB errors carry their numeric code first; the message itself
        # is not audited because it can quote row values.
        outcome = type(exc).__name__
        if exc.args and isinstance(exc.args[0], int):
            outcome += f" {exc.args[0]}"
        await _audit(f"failed ({outcome})")
        return SqlExecuteResult(
            success=False,
            query=req.query,
            error=str(exc),
        )

    finally:
        if conn:
            conn.close()


@router.get("/tables", response_model=list[TableInfo])
async def list_tables(
    database: DatabaseTarget = Query("panel"),
    _admin: dict = Depends(require_admin),
):
    """
    List all tables in the requested database with basic size information.

    Reads from ``information_schema.TABLES`` to avoid running raw SHOW
    statements, which ensures consistent column names across MariaDB versions.
    """
    params = _resolve_connection_params(database)
    conn: aiomysql.Connection | None = None
    try:
        conn = await _get_connection(database)
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
                (params["db"],),
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

    except HTTPException:
        raise
    except Exception as exc:
        log.error("SQL Console: table listing failed — %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))

    finally:
        if conn:
            conn.close()


@router.get("/tables/{table_name}/schema", response_model=list[ColumnInfo])
async def get_table_schema(
    table_name: str,
    database: DatabaseTarget = Query("panel"),
    _admin: dict = Depends(require_admin),
):
    """
    Return column-level metadata for the specified table.

    Uses ``information_schema.COLUMNS`` to retrieve type, nullability, key
    info, defaults, and auto-increment status.
    """
    params = _resolve_connection_params(database)
    conn: aiomysql.Connection | None = None
    try:
        conn = await _get_connection(database)
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
                (params["db"], table_name),
            )
            rows = await cur.fetchall()

        if not rows:
            raise HTTPException(
                status_code=404,
                detail=f"Table '{table_name}' not found in database "
                       f"'{params['db']}'.",
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
