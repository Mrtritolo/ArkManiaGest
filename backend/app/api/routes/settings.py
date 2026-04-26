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
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiomysql
import httpx

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
    DualDatabaseConfigRead,
    DatabaseTestRequest,
    VersionCheckResponse,
)

log = logging.getLogger("arkmaniagest.settings")

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
    await set_setting_async(db, "app_version", "3.5.1", description="Application version")
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
        version=await get_setting_async(db, "app_version") or "3.5.1",
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

@router.get("/database", response_model=DualDatabaseConfigRead)
async def get_database_config(_admin: dict = Depends(require_admin)):
    """
    Return the current database configuration from .env (admin only).

    Returns details for both the panel and plugin databases.  When no
    ``PLUGIN_DB_*`` variables are configured, the plugin block reflects the
    panel values and ``plugin_configured`` is False.  Passwords are never
    returned — only a ``has_password`` flag per connection.
    """
    s = server_settings
    return DualDatabaseConfigRead(
        panel=DatabaseConfigRead(
            host=s.DB_HOST,
            port=s.DB_PORT,
            name=s.DB_NAME,
            user=s.DB_USER,
            has_password=bool(s.DB_PASSWORD),
        ),
        plugin=DatabaseConfigRead(
            host=s.plugin_db_host,
            port=s.plugin_db_port,
            name=s.plugin_db_name,
            user=s.plugin_db_user,
            has_password=bool(s.plugin_db_password),
        ),
        plugin_is_separate=s.plugin_db_is_separate,
        plugin_configured=bool(s.PLUGIN_DB_HOST or s.PLUGIN_DB_NAME),
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


async def _test_current(host: str, port: int, user: str, password: str, name: str) -> dict:
    """Shared connectivity helper used by the panel/plugin test endpoints."""
    if not password:
        return {"success": False, "message": "Password is not configured in .env."}
    try:
        conn = await aiomysql.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            db=name,
            connect_timeout=5,
        )
        conn.close()
        return {"success": True, "message": f"Connected to {host}:{port}/{name}."}
    except Exception as exc:
        return {"success": False, "message": f"Connection failed: {exc}"}


@router.post("/database/test-current")
async def test_current_database(_admin: dict = Depends(require_admin)):
    """Test connectivity to the **panel** database using .env credentials."""
    s = server_settings
    return await _test_current(s.DB_HOST, s.DB_PORT, s.DB_USER, s.DB_PASSWORD, s.DB_NAME)


@router.post("/database/test-plugin")
async def test_current_plugin_database(_admin: dict = Depends(require_admin)):
    """Test connectivity to the **plugin** database using .env credentials."""
    s = server_settings
    return await _test_current(
        s.plugin_db_host,
        s.plugin_db_port,
        s.plugin_db_user,
        s.plugin_db_password,
        s.plugin_db_name,
    )


# ── Version / update check ───────────────────────────────────────────────────
#
# In-memory cache: ``(expires_at, VersionCheckResponse)``.  A second request
# within the TTL returns the cached response without hitting the GitHub API.
# Resets on every backend restart.
_VERSION_CACHE: tuple[float, Optional[VersionCheckResponse]] = (0.0, None)
_VERSION_CACHE_TTL_SECONDS = 60 * 60          # 1 hour
_GITHUB_API_TIMEOUT_SECONDS = 6
_VERSION_MANIFEST_CANDIDATES = (
    Path("/opt/arkmaniagest/VERSION.json"),
    Path(__file__).resolve().parents[3] / "VERSION.json",
)


def _local_version_info() -> tuple[str, Optional[str], Optional[str]]:
    """
    Return ``(version, commit, built_at)`` for the running backend.

    Prefers the ``VERSION.json`` file produced by the release packager
    (``deploy/package-release.ps1``), falls back to the FastAPI app's
    ``version`` attribute when the file is absent (dev / source checkout).
    """
    for candidate in _VERSION_MANIFEST_CANDIDATES:
        try:
            if candidate.is_file():
                data = json.loads(candidate.read_text(encoding="utf-8"))
                return (
                    str(data.get("version", "")),
                    data.get("commit"),
                    data.get("built_at"),
                )
        except Exception as exc:
            log.debug("VERSION.json read failed at %s: %s", candidate, exc)

    # Fallback: read the value hardcoded in the FastAPI constructor.
    from app.main import app as fastapi_app
    return str(getattr(fastapi_app, "version", "") or ""), None, None


def _parse_semver(text: str) -> tuple[int, int, int, str]:
    """
    Very permissive semver parser: returns (major, minor, patch, prerelease).

    Missing components default to 0.  Non-numeric suffixes (``rc1``, ``beta``)
    keep their natural alphabetical order but sort BEFORE an empty suffix,
    so ``2.3.0`` > ``2.3.0-rc1``.
    """
    s = text.lstrip("vV").strip()
    pre = ""
    if "-" in s:
        s, pre = s.split("-", 1)
    if "+" in s:  # build metadata — ignored for ordering
        s = s.split("+", 1)[0]
    parts = s.split(".") + ["0", "0", "0"]

    def _as_int(v: str) -> int:
        try:
            return int(v)
        except ValueError:
            return 0

    major, minor, patch = _as_int(parts[0]), _as_int(parts[1]), _as_int(parts[2])
    return major, minor, patch, pre


def _semver_gt(new: str, current: str) -> bool:
    """True if *new* is strictly newer than *current* per :func:`_parse_semver`."""
    nmaj, nmin, npat, npre = _parse_semver(new)
    cmaj, cmin, cpat, cpre = _parse_semver(current)
    if (nmaj, nmin, npat) != (cmaj, cmin, cpat):
        return (nmaj, nmin, npat) > (cmaj, cmin, cpat)
    # Same base: empty prerelease ("") is considered greater than any suffix.
    if npre == cpre:
        return False
    if not npre:   # new is stable, current is a pre-release → newer
        return True
    if not cpre:   # current is stable, new is a pre-release → older
        return False
    return npre > cpre


@router.get("/version-check", response_model=VersionCheckResponse)
async def check_for_updates(
    _admin: dict = Depends(require_admin),
    force: bool = False,
) -> VersionCheckResponse:
    """
    Report whether a newer ArkManiaGest release is available on GitHub.

    Read-side only: hits the GitHub Releases API once per hour (cached),
    compares the returned ``tag_name`` with the local version, and returns
    the comparison result.  The query runs server-side so the browser never
    talks to the GitHub API directly (CORS, rate limits, IP fingerprinting).

    ``force=true`` bypasses the cache for manual re-checks.
    """
    global _VERSION_CACHE

    current, current_commit, current_built_at = _local_version_info()

    now = time.time()
    cached_expires, cached_payload = _VERSION_CACHE
    if not force and cached_payload is not None and now < cached_expires:
        # Re-issue the cached payload but refresh the "current" fields —
        # those come from a local file and are cheap to re-read.
        return cached_payload.model_copy(update={
            "current": current,
            "current_commit": current_commit,
            "current_built_at": current_built_at,
        })

    repo = server_settings.GITHUB_REPO.strip()
    if not repo or "/" not in repo:
        payload = VersionCheckResponse(
            current=current,
            current_commit=current_commit,
            current_built_at=current_built_at,
            error="GITHUB_REPO is not configured in .env.",
            cached_at=datetime.now(timezone.utc).isoformat(),
        )
        _VERSION_CACHE = (now + _VERSION_CACHE_TTL_SECONDS, payload)
        return payload

    url = f"https://api.github.com/repos/{repo}/releases/latest"
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "ArkManiaGest-UpdateCheck",
    }
    if server_settings.GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {server_settings.GITHUB_TOKEN}"

    try:
        async with httpx.AsyncClient(timeout=_GITHUB_API_TIMEOUT_SECONDS) as client:
            r = await client.get(url, headers=headers)
    except Exception as exc:
        payload = VersionCheckResponse(
            current=current,
            current_commit=current_commit,
            current_built_at=current_built_at,
            error=f"GitHub request failed: {exc}",
            cached_at=datetime.now(timezone.utc).isoformat(),
        )
        # Cache errors with a short TTL so a flaky network doesn't DOS us.
        _VERSION_CACHE = (now + 60, payload)
        return payload

    if r.status_code == 404:
        payload = VersionCheckResponse(
            current=current,
            current_commit=current_commit,
            current_built_at=current_built_at,
            error="No releases published yet.",
            cached_at=datetime.now(timezone.utc).isoformat(),
        )
        _VERSION_CACHE = (now + _VERSION_CACHE_TTL_SECONDS, payload)
        return payload

    if r.status_code != 200:
        # 403/429 are GitHub's rate-limit signals.  Translate the relevant
        # headers into a "retry in N minutes" hint and, when the call went
        # in unauthenticated, suggest adding GITHUB_TOKEN to .env.
        from app.services.self_updater import _format_github_error
        msg = _format_github_error(
            r, url,
            had_token=bool(server_settings.GITHUB_TOKEN),
        )
        payload = VersionCheckResponse(
            current=current,
            current_commit=current_commit,
            current_built_at=current_built_at,
            error=msg,
            cached_at=datetime.now(timezone.utc).isoformat(),
        )
        # For rate-limit responses, cache until the reset time so we don't
        # keep hammering GitHub and making the situation worse.
        if r.status_code in (403, 429):
            reset_raw = r.headers.get("X-RateLimit-Reset")
            if reset_raw:
                try:
                    reset_ts = int(reset_raw)
                    ttl = max(60, reset_ts - int(now))
                    _VERSION_CACHE = (now + min(ttl, 3600), payload)
                    return payload
                except ValueError:
                    pass
        _VERSION_CACHE = (now + 60, payload)
        return payload

    data = r.json()
    tag_name = str(data.get("tag_name") or data.get("name") or "").strip()
    latest = tag_name.lstrip("vV") if tag_name else None
    update_available = bool(current and latest and _semver_gt(latest, current))

    payload = VersionCheckResponse(
        current=current,
        current_commit=current_commit,
        current_built_at=current_built_at,
        latest=latest,
        update_available=update_available,
        release_url=data.get("html_url"),
        release_name=data.get("name"),
        release_published_at=data.get("published_at"),
        release_notes=data.get("body"),
        cached_at=datetime.now(timezone.utc).isoformat(),
    )
    _VERSION_CACHE = (now + _VERSION_CACHE_TTL_SECONDS, payload)
    return payload
