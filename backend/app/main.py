"""
ArkManiaGest — FastAPI backend entry point.

Configuration architecture:
  - DB credentials, JWT secret, encryption key  → .env file
  - Users, SSH machines, app settings           → database (arkmaniagest_* tables)
  - The backend starts directly with no manual unlock step.
"""
import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import server_settings

IS_PRODUCTION = not server_settings.DEBUG
log = logging.getLogger("arkmaniagest")


# =============================================
#  Lifespan (startup / shutdown)
# =============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan handler.

    Startup sequence:
      1. Generate missing secrets and persist them to .env
      2. Initialise AES-256-GCM field encryption
      3. Connect to the database and create missing application tables

    Shutdown:
      - Dispose the async SQLAlchemy engine
    """
    # --- Startup ---
    # 1. Generate JWT_SECRET / FIELD_ENCRYPTION_KEY if not present in .env
    server_settings.ensure_secrets()

    # 2. Initialise field encryption
    from app.core.encryption import init_encryption
    init_encryption(server_settings.FIELD_ENCRYPTION_KEY)
    log.info("AES-256-GCM field encryption initialised")

    # 3. Initialise the async DB engines (panel + plugin)
    from app.db.session import (
        init_engine, init_plugin_engine, create_app_tables,
    )
    if server_settings.DB_PASSWORD:
        init_engine(server_settings.database_url, debug=server_settings.DEBUG)
        log.info(
            "Panel DB connected: %s:%s/%s",
            server_settings.DB_HOST,
            server_settings.DB_PORT,
            server_settings.DB_NAME,
        )

        # 4. Create panel tables if they do not exist yet
        await create_app_tables()
        log.info("arkmaniagest_* panel tables verified / created")

        # 5. Initialise the plugin DB engine (falls back to panel DSN when
        #    no PLUGIN_DB_* variables are configured in .env)
        init_plugin_engine(
            server_settings.plugin_database_url,
            debug=server_settings.DEBUG,
        )
        if server_settings.plugin_db_is_separate:
            log.info(
                "Plugin DB connected: %s:%s/%s",
                server_settings.plugin_db_host,
                server_settings.plugin_db_port,
                server_settings.plugin_db_name,
            )
        else:
            log.info("Plugin DB: shared with panel DB (no PLUGIN_DB_* configured)")
    else:
        log.warning(
            "DB_PASSWORD not set in .env — backend running in limited mode"
        )

    yield

    # --- Shutdown ---
    from app.db.session import close_engine, close_plugin_engine
    await close_plugin_engine()
    await close_engine()
    log.info("Database connections closed")


app = FastAPI(
    title="ArkManiaGest",
    version="3.3.1",
    description="Comprehensive manager for ARK: Survival Ascended servers",
    # Docs endpoints are disabled in production
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
    redirect_slashes=False,
    lifespan=lifespan,
)


# =============================================
#  Security middleware (registered before CORS)
# =============================================
from app.core.security import (
    RateLimitMiddleware,
    SecurityHeadersMiddleware,
    RequestSizeLimitMiddleware,
)

# Append security headers to every response
app.add_middleware(SecurityHeadersMiddleware)

# Rate limiting: relaxed in debug mode, stricter in production
app.add_middleware(
    RateLimitMiddleware,
    general_limit=200 if server_settings.DEBUG else 120,
    auth_limit=20 if server_settings.DEBUG else 10,
)

# Reject request bodies larger than 10 MB
app.add_middleware(RequestSizeLimitMiddleware, max_size=10 * 1024 * 1024)

# Optional IP allowlist (comma-separated in ALLOWED_IPS env var)
if server_settings.ALLOWED_IPS:
    from app.core.security import IPWhitelistMiddleware
    allowed = {ip.strip() for ip in server_settings.ALLOWED_IPS.split(',') if ip.strip()}
    if allowed:
        app.add_middleware(IPWhitelistMiddleware, allowed_ips=allowed)

# =============================================
#  CORS
# =============================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=server_settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining"],
)


# =============================================
#  Health check
# =============================================
@app.get("/health", tags=["System"])
async def health_check():
    """Return basic liveness/readiness information."""
    from app.db import session as db_session
    return {
        "status": "ok",
        "app": "ArkManiaGest",
        "version": "3.3.1",
        "db_ready": db_session._async_session is not None,
        "plugin_db_ready": db_session._plugin_async_session is not None,
        "pid": os.getpid(),
    }


# =============================================
#  Global exception handler
# =============================================
#
# Default FastAPI behaviour for any uncaught exception is to log
# `Exception in ASGI application` to stderr and reply with
# `Internal Server Error` (no JSON body, no detail).  That gives
# the frontend nothing to display and us nothing to debug, which is
# exactly what bit the v2.3.8 -> v2.3.9 self-update flow ("Request
# failed with status code 500" + an empty backend-error.log).
#
# This handler:
#   * always returns a proper JSON `{detail: ...}` body so the UI's
#     existing axios interceptor + error handlers show a real message,
#   * logs the full traceback at ERROR level (which systemd routes to
#     /var/log/arkmaniagest/backend-error.log via StandardError=append),
#   * includes the exception class name so a single-line UI toast
#     stays useful ("AttributeError: 'NoneType' object has no ...").
import logging as _logging
import traceback as _traceback
from fastapi import Request as _Request
from fastapi.responses import JSONResponse as _JSONResponse

_log = _logging.getLogger("arkmaniagest.exceptions")


@app.exception_handler(Exception)
async def _global_exception_handler(request: _Request, exc: Exception):
    _log.exception(
        "Unhandled exception during %s %s: %s",
        request.method, request.url.path, exc,
    )
    # Best-effort: include path + class + message in the response body
    # so the UI can show "POST /system-update/install: AttributeError: ..."
    # instead of an empty 500.
    return _JSONResponse(
        status_code=500,
        content={
            "detail": f"{type(exc).__name__}: {exc}",
            "path":   request.url.path,
        },
    )


# =============================================
#  API routes
# =============================================
from app.api.routes import router as api_router
app.include_router(api_router, prefix="/api/v1")
