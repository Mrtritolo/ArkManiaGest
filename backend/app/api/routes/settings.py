"""
api/routes/settings.py — Application setup and configuration endpoints.

Public endpoints (no JWT required):
    GET  /settings/status               — Application configuration state
    POST /settings/setup                — First-run admin user creation

Protected endpoints:
    GET  /settings/app-settings         — Read general application settings
    PUT  /settings/app-settings         — Update general settings (admin only)
    GET  /settings/database             — Read database config from .env (admin)
    POST /settings/database/test        — Test a custom DB connection
    POST /settings/database/test-current — Test the active DB connection
"""
import aiomysql
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.auth import require_admin, get_current_user, hash_password
from app.core.store import (
    get_setting_async,
    set_setting_async,
    get_all_users,
    create_user,
)
from app.core.config import server_settings
from app.schemas.settings import (
    AppStatus,
    SetupRequest,
    AppSettingsRead,
    AppSettingsUpdate,
    DatabaseConfigRead,
    DatabaseTestRequest,
)

router = APIRouter()


# ── Application status (public) ───────────────────────────────────────────────

@router.get("/status")
async def app_status(db: AsyncSession = Depends(get_db)):
    """
    Return the current configuration state.

    Used by the frontend to decide whether to show the setup wizard
    (no users) or the login page (users exist) on first load.
    """
    users = await get_all_users(db)
    return {
        "configured":   len(users) > 0,
        "users_count":  len(users),
        "db_connected": True,
    }


# ── First-run setup (public) ──────────────────────────────────────────────────

@router.post("/setup")
async def initial_setup(req: SetupRequest, db: AsyncSession = Depends(get_db)):
    """
    Perform first-run setup: create the initial admin user and base settings.

    Only succeeds when the ``arkmaniagest_users`` table is empty.  Subsequent
    calls return HTTP 409 to prevent accidental re-initialisation.
    """
    existing_users = await get_all_users(db)
    if existing_users:
        raise HTTPException(
            status_code=409,
            detail="Setup already completed. Users exist in the database.",
        )

    user_data = {
        "username":      req.admin_username.lower().strip(),
        "password_hash": hash_password(req.admin_password),
        "display_name":  req.admin_display_name.strip(),
        "role":          "admin",
        "active":        True,
        "created_at":    datetime.now(timezone.utc),
    }
    await create_user(db, user_data)

    await set_setting_async(
        db, "app_name", req.app_name or "ArkManiaGest",
        description="Application name",
    )
    await set_setting_async(db, "app_version", "2.2.0", description="Application version")
    await set_setting_async(
        db, "log_level", req.log_level or "INFO",
        description="Log level",
    )

    return {
        "success":        True,
        "message":        "Setup complete. Admin user created.",
        "admin_username": req.admin_username.lower().strip(),
    }


# ── Application settings ──────────────────────────────────────────────────────

@router.get("/app-settings", response_model=AppSettingsRead)
async def get_app_settings(
    _user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Read general application settings from the database."""
    return AppSettingsRead(
        app_name=await get_setting_async(db, "app_name") or "ArkManiaGest",
        version=await get_setting_async(db, "app_version") or "2.2.0",
        log_level=await get_setting_async(db, "log_level") or "INFO",
        auto_backup=(await get_setting_async(db, "auto_backup") or "true") == "true",
        backup_interval_hours=int(
            await get_setting_async(db, "backup_interval_hours") or "6"
        ),
        backup_retention=int(
            await get_setting_async(db, "backup_retention") or "10"
        ),
    )


@router.put("/app-settings", response_model=AppSettingsRead)
async def update_app_settings(
    updates: AppSettingsUpdate,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update one or more general application settings (admin only)."""
    data = updates.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update.")

    for key, value in data.items():
        # Store booleans as lowercase strings for consistent retrieval
        str_value = str(value).lower() if isinstance(value, bool) else str(value)
        await set_setting_async(db, key, str_value)

    return await get_app_settings(_user=admin, db=db)


# ── Database configuration ────────────────────────────────────────────────────

@router.get("/database", response_model=DatabaseConfigRead)
async def get_database_config(_admin: dict = Depends(require_admin)):
    """
    Return the current database configuration from .env (admin only).

    The actual password is never returned — only a boolean indicating
    whether one is configured.
    """
    return DatabaseConfigRead(
        host=server_settings.DB_HOST,
        port=server_settings.DB_PORT,
        name=server_settings.DB_NAME,
        user=server_settings.DB_USER,
        has_password=bool(server_settings.DB_PASSWORD),
    )


@router.post("/database/test")
async def test_database_connection(req: DatabaseTestRequest):
    """
    Test connectivity to a MariaDB/MySQL database with the supplied credentials.

    This endpoint requires no authentication so it can be called during the
    setup wizard before any users exist.
    """
    try:
        conn = await aiomysql.connect(
            host=req.host,
            port=req.port,
            user=req.user,
            password=req.password,
            db=req.name,
            connect_timeout=5,
        )
        conn.close()
        return {
            "success": True,
            "message": f"Connected to {req.host}:{req.port}/{req.name}.",
        }
    except Exception as exc:
        return {"success": False, "message": f"Connection failed: {exc}"}


@router.post("/database/test-current")
async def test_current_database(_admin: dict = Depends(require_admin)):
    """
    Test connectivity using the credentials currently in .env (admin only).
    """
    s = server_settings
    if not s.DB_PASSWORD:
        return {"success": False, "message": "DB_PASSWORD is not configured in .env."}

    try:
        conn = await aiomysql.connect(
            host=s.DB_HOST,
            port=s.DB_PORT,
            user=s.DB_USER,
            password=s.DB_PASSWORD,
            db=s.DB_NAME,
            connect_timeout=5,
        )
        conn.close()
        return {
            "success": True,
            "message": f"Connected to {s.DB_HOST}:{s.DB_PORT}/{s.DB_NAME}.",
        }
    except Exception as exc:
        return {"success": False, "message": f"Connection failed: {exc}"}
