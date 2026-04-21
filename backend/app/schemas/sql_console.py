"""
schemas/sql_console.py — Pydantic models for the SQL Console endpoints.

Defines request/response shapes for arbitrary SQL query execution,
table listing, and schema introspection.
"""
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# Database targets supported by the SQL Console.  ``panel`` is the database
# that stores ArkManiaGest's own data; ``plugin`` is the separate database
# used by the game plugins (falls back to ``panel`` when no PLUGIN_DB_* is
# configured in .env).
DatabaseTarget = Literal["panel", "plugin"]


# ── Request models ────────────────────────────────────────────────────────────

class SqlExecuteRequest(BaseModel):
    """Payload for POST /sql/execute."""

    query: str = Field(
        ...,
        min_length=1,
        max_length=50_000,
        description="SQL query to execute against the configured database.",
    )
    params: Optional[list[Any]] = Field(
        default=None,
        description="Optional positional parameters for parameterised queries.",
    )
    database: DatabaseTarget = Field(
        default="panel",
        description="Which database to target: 'panel' (default) or 'plugin'.",
    )


# ── Response models ───────────────────────────────────────────────────────────

class SqlExecuteResult(BaseModel):
    """Result of a SQL query execution."""

    success: bool
    query: str = Field(description="The SQL query that was executed.")
    columns: list[str] = Field(
        default_factory=list,
        description="Column names for SELECT-type queries.",
    )
    rows: list[list[Any]] = Field(
        default_factory=list,
        description="Result rows (each row is a list of cell values).",
    )
    row_count: int = Field(
        default=0,
        description="Number of rows returned (SELECT) or affected (DML).",
    )
    execution_time_ms: float = Field(
        default=0.0,
        description="Query execution time in milliseconds.",
    )
    message: str = Field(
        default="",
        description="Informational message (e.g. affected rows for DML).",
    )
    error: Optional[str] = Field(
        default=None,
        description="Error message if the query failed.",
    )


class TableInfo(BaseModel):
    """Summary information for a single database table."""

    name: str
    engine: Optional[str] = None
    row_count: Optional[int] = None
    data_size_kb: Optional[float] = None
    comment: Optional[str] = None


class ColumnInfo(BaseModel):
    """Column metadata for a single table column."""

    name: str
    data_type: str
    is_nullable: bool
    column_default: Optional[str] = None
    column_key: Optional[str] = None
    extra: Optional[str] = None
    comment: Optional[str] = None
