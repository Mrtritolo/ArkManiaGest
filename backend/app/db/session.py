"""
Async SQLAlchemy engines and session factories for the two ArkManiaGest
databases:

* **panel**   — data owned by ArkManiaGest itself (users, SSH machines,
  settings, server instances, MariaDB instances, action log, container cache).
  Tables: ``arkmaniagest_*`` and ``ARKM_*`` reserved for panel data
  (``ARKM_server_instances``, ``ARKM_instance_actions``,
  ``ARKM_mariadb_instances``).

* **plugin** — data owned by the ArkMania game plugins (``ARKM_config``,
  ``ARKM_bans``, ``ARKM_rare_dinos``, ``ARKM_players``, ``ARKM_lb_*``,
  ``ARKM_decay_*``, etc.) plus the native ARK tables (``Players``,
  ``ArkShopPlayers``, ``PermissionGroups``, ``TribePermissions``).

Connection URLs are built from environment variables via
:mod:`app.core.config`.  When no ``PLUGIN_DB_*`` variables are set the
plugin engine transparently points to the same DSN as the panel engine,
so legacy single-database installations keep working unchanged.
"""
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

# Module-level singletons — initialised by init_engine() / init_plugin_engine()
_engine = None
_async_session = None

_plugin_engine = None
_plugin_async_session = None


class Base(DeclarativeBase):
    """Declarative base shared by all ORM models."""
    pass


# =============================================================================
#  Panel DB
# =============================================================================

def init_engine(
    database_url: str = None,
    pool_size: int = 10,
    max_overflow: int = 20,
    debug: bool = False,
) -> None:
    """
    Create the async SQLAlchemy engine and session factory for the panel DB.

    If *database_url* is not supplied, the URL is read from
    :attr:`~app.core.config.ServerSettings.database_url`.

    Args:
        database_url: SQLAlchemy async connection string.
        pool_size:    Number of persistent connections in the pool.
        max_overflow: Extra connections allowed beyond *pool_size*.
        debug:        When True, SQL statements are echoed to stdout.
    """
    global _engine, _async_session

    if not database_url:
        from app.core.config import server_settings
        database_url = server_settings.database_url

    _engine = create_async_engine(
        database_url,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_pre_ping=True,   # reconnect on stale connections
        pool_recycle=1800,    # recycle connections every 30 min (MariaDB wait_timeout safety)
        echo=debug,
    )
    _async_session = async_sessionmaker(
        _engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )


async def create_app_tables() -> None:
    """
    Create panel-owned tables that do not yet exist.

    Only the tables defined in :mod:`app.db.models.app` are created — the
    ARK plugin ORM models in :mod:`app.db.models.ark` share the same
    ``Base`` but live in the plugin database and must NEVER be created by
    ArkManiaGest (they are owned by the game plugins).
    """
    global _engine
    if _engine is None:
        return

    # Import panel models so that they register themselves with Base.metadata.
    # Import ark models too so their ``__table__`` objects are available for
    # the exclusion filter below (guards against accidental leakage if a
    # future create_all call uses the full metadata).
    from app.db.models import app as app_models  # noqa: F401
    from app.db.models import ark as ark_models  # noqa: F401

    panel_tables = [
        mapper.__table__
        for name, mapper in vars(app_models).items()
        if isinstance(mapper, type)
        and hasattr(mapper, "__table__")
        and mapper.__module__ == app_models.__name__
    ]

    async with _engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: Base.metadata.create_all(sync_conn, tables=panel_tables)
        )
        # Idempotent in-place migrations.  SQLAlchemy create_all() never
        # ALTERs an existing table, so any column we add to an
        # already-created model needs an explicit ALTER here -- guarded
        # by INFORMATION_SCHEMA so re-runs are no-ops.
        await _add_column_if_missing(
            conn,
            table="arkmaniagest_discord_accounts",
            column="app_user_id",
            ddl=(
                "ALTER TABLE arkmaniagest_discord_accounts "
                "ADD COLUMN app_user_id INT NULL, "
                "ADD UNIQUE KEY uq_discord_app_user (app_user_id), "
                "ADD CONSTRAINT fk_discord_app_user "
                "  FOREIGN KEY (app_user_id) "
                "  REFERENCES arkmaniagest_users(id) ON DELETE SET NULL"
            ),
        )


async def _add_column_if_missing(conn, *, table: str, column: str, ddl: str) -> None:
    """
    Run *ddl* only when *column* does not yet exist on *table*.

    Used to push tiny in-place migrations on top of create_all().  Pure
    DDL guarded by INFORMATION_SCHEMA so the function is safe to call
    on every boot.
    """
    from sqlalchemy import text as _sql_text
    res = await conn.execute(
        _sql_text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = DATABASE() "
            "  AND table_name   = :t "
            "  AND column_name  = :c "
            "LIMIT 1"
        ),
        {"t": table, "c": column},
    )
    if res.scalar() is None:
        try:
            await conn.execute(_sql_text(ddl))
        except Exception:
            # Most likely the table itself doesn't exist yet (fresh
            # install) -- create_all() above already handled it, so
            # the column is in place via the column definition itself.
            pass


async def get_db() -> AsyncSession:
    """
    FastAPI dependency: yield a scoped session against the **panel** DB.

    Commits the transaction on success and rolls back on any exception.
    If the session factory has not been initialised yet, a lazy
    :func:`init_engine` call is attempted first.

    Raises:
        HTTPException 500: Panel database is not configured.
    """
    global _async_session

    if _async_session is None:
        init_engine()

    if _async_session is None:
        raise HTTPException(
            status_code=500,
            detail="Panel database not configured. Check your .env file.",
        )

    async with _async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# Alias kept for clarity at call-sites that want to be explicit.
get_panel_db = get_db


async def close_engine() -> None:
    """Dispose the panel engine and reset the module-level singletons."""
    global _engine, _async_session
    if _engine:
        await _engine.dispose()
        _engine = None
        _async_session = None


# =============================================================================
#  Plugin DB
# =============================================================================

def init_plugin_engine(
    database_url: str = None,
    pool_size: int = 10,
    max_overflow: int = 20,
    debug: bool = False,
) -> None:
    """
    Create the async SQLAlchemy engine and session factory for the plugin DB.

    When ``PLUGIN_DB_*`` variables are empty in .env, the URL resolves to the
    panel DSN, so route handlers using :func:`get_plugin_db` keep working on
    single-database deployments.

    Args:
        database_url: SQLAlchemy async connection string.
        pool_size:    Number of persistent connections in the pool.
        max_overflow: Extra connections allowed beyond *pool_size*.
        debug:        When True, SQL statements are echoed to stdout.
    """
    global _plugin_engine, _plugin_async_session

    if not database_url:
        from app.core.config import server_settings
        database_url = server_settings.plugin_database_url

    _plugin_engine = create_async_engine(
        database_url,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_pre_ping=True,
        pool_recycle=1800,
        echo=debug,
    )
    _plugin_async_session = async_sessionmaker(
        _plugin_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )


async def get_plugin_db() -> AsyncSession:
    """
    FastAPI dependency: yield a scoped session against the **plugin** DB.

    Behaves exactly like :func:`get_db` but returns a session bound to
    :data:`_plugin_engine`.  Used by routes that only read/write the game
    plugin tables (``ARKM_bans``, ``ARKM_rare_dinos``, ``ARKM_lb_*``, etc.).

    Raises:
        HTTPException 500: Plugin database is not configured.
    """
    global _plugin_async_session

    if _plugin_async_session is None:
        init_plugin_engine()

    if _plugin_async_session is None:
        raise HTTPException(
            status_code=500,
            detail="Plugin database not configured. Check your .env file.",
        )

    async with _plugin_async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def close_plugin_engine() -> None:
    """Dispose the plugin engine and reset the module-level singletons."""
    global _plugin_engine, _plugin_async_session
    if _plugin_engine:
        await _plugin_engine.dispose()
        _plugin_engine = None
        _plugin_async_session = None
