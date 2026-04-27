"""
schemas/settings.py — Pydantic schemas for setup and application configuration.
"""

from typing import Optional
from pydantic import BaseModel, Field


# ── Application status ────────────────────────────────────────────────────────

class AppStatus(BaseModel):
    """High-level application configuration state."""

    configured: bool
    users_count: int
    db_connected: bool


# ── First-run setup ───────────────────────────────────────────────────────────

class SetupRequest(BaseModel):
    """
    Payload for the first-run setup endpoint.

    Creates the initial admin user and persists basic application settings.
    """

    admin_username: str = Field(default="admin", min_length=2, max_length=50)
    admin_password: str = Field(..., min_length=6)
    admin_display_name: str = Field(default="Administrator", max_length=100)
    app_name: str = "ArkManiaGest"
    log_level: str = "INFO"


# ── General application settings ─────────────────────────────────────────────

class AppSettingsRead(BaseModel):
    """Application settings as returned by the read endpoint."""

    app_name: str = "ArkManiaGest"
    version: str = "3.5.5"
    log_level: str = "INFO"
    auto_backup: bool = True
    backup_interval_hours: int = 6
    backup_retention: int = 10


class AppSettingsUpdate(BaseModel):
    """Fields that can be updated via the settings endpoint (all optional)."""

    app_name: Optional[str] = None
    log_level: Optional[str] = Field(
        None,
        pattern=r"^(DEBUG|INFO|WARNING|ERROR|CRITICAL)$",
    )
    auto_backup: Optional[bool] = None
    backup_interval_hours: Optional[int] = Field(None, ge=1, le=168)
    backup_retention: Optional[int] = Field(None, ge=1, le=100)


# ── Database configuration ────────────────────────────────────────────────────

class DatabaseConfigRead(BaseModel):
    """
    Database connection details (read-only view from .env).

    The actual password is never returned; ``has_password`` indicates
    whether one is configured.
    """

    host: str
    port: int
    name: str
    user: str
    has_password: bool


class DualDatabaseConfigRead(BaseModel):
    """
    Connection details for both the panel and plugin databases.

    When ``plugin_configured`` is False the plugin database falls back to
    the panel DSN, so ``plugin`` reflects the effective runtime values
    rather than empty placeholders.
    """

    panel: DatabaseConfigRead
    plugin: DatabaseConfigRead
    plugin_is_separate: bool
    plugin_configured: bool


class DatabaseTestRequest(BaseModel):
    """Credentials for ad-hoc database connectivity testing."""

    host: str
    port: int = Field(ge=1, le=65_535)
    name: str
    user: str
    password: str


# ── Version / update check ───────────────────────────────────────────────────

class VersionCheckResponse(BaseModel):
    """
    Result of a GitHub release check.

    Populated by :func:`app.api.routes.settings.check_for_updates`; cached
    in-memory for an hour between calls so the GitHub API rate limit is
    respected.  ``update_available`` is ``True`` iff ``latest`` compares
    greater than ``current`` via standard semver ordering.
    """

    current: str
    current_commit: Optional[str] = None
    current_built_at: Optional[str] = None
    latest: Optional[str] = None
    update_available: bool = False
    release_url: Optional[str] = None
    release_name: Optional[str] = None
    release_published_at: Optional[str] = None
    release_notes: Optional[str] = None
    cached_at: Optional[str] = None
    # Populated when the GitHub API cannot be reached or returns an error.
    error: Optional[str] = None
