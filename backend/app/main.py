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

    # 3. Initialise the async DB engine
    from app.db.session import init_engine, create_app_tables
    if server_settings.DB_PASSWORD:
        init_engine(server_settings.database_url, debug=server_settings.DEBUG)
        log.info(
            "Database connected: %s:%s/%s",
            server_settings.DB_HOST,
            server_settings.DB_PORT,
            server_settings.DB_NAME,
        )

        # 4. Create application tables if they do not exist yet
        await create_app_tables()
        log.info("arkmaniagest_* tables verified / created")
    else:
        log.warning(
            "DB_PASSWORD not set in .env — backend running in limited mode"
        )

    yield

    # --- Shutdown ---
    from app.db.session import close_engine
    await close_engine()
    log.info("Database connection closed")


app = FastAPI(
    title="ArkManiaGest",
    version="2.2.2",
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
    from app.db.session import _async_session
    return {
        "status": "ok",
        "app": "ArkManiaGest",
        "version": "2.2.2",
        "db_ready": _async_session is not None,
        "pid": os.getpid(),
    }


# =============================================
#  API routes
# =============================================
from app.api.routes import router as api_router
app.include_router(api_router, prefix="/api/v1")
