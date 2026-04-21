"""
Async SQLAlchemy engine and session management for MariaDB.

The connection URL is built from environment variables via
:mod:`app.core.config`.
"""
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

# Module-level singletons — initialised by init_engine()
_engine = None
_async_session = None


class Base(DeclarativeBase):
    """Declarative base shared by all ORM models."""
    pass


def init_engine(
    database_url: str = None,
    pool_size: int = 10,
    max_overflow: int = 20,
    debug: bool = False,
) -> None:
    """
    Create the async SQLAlchemy engine and session factory.

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
    Create all ``arkmaniagest_*`` tables that do not yet exist.

    Pre-existing ARK plugin tables (e.g. ``Players``) are not touched because
    :meth:`Base.metadata.create_all` only creates tables it knows about.
    """
    global _engine
    if _engine is None:
        return

    # Import models so that they register themselves with Base.metadata
    import app.db.models.app  # noqa: F401

    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db() -> AsyncSession:
    """
    FastAPI dependency: yield a scoped async database session.

    Commits the transaction on success and rolls back on any exception.
    If the session factory has not been initialised yet, a lazy
    :func:`init_engine` call is attempted first.

    Raises:
        HTTPException 500: Database is not configured (no .env password).
    """
    global _async_session

    if _async_session is None:
        init_engine()

    if _async_session is None:
        raise HTTPException(
            status_code=500,
            detail="Database not configured. Check your .env file.",
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


async def close_engine() -> None:
    """Dispose the engine and reset the module-level singletons."""
    global _engine, _async_session
    if _engine:
        await _engine.dispose()
        _engine = None
        _async_session = None
