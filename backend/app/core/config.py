"""
Server configuration loaded from environment variables / .env file.

Bootstrap parameters (host, port, CORS, debug mode) and sensitive credentials
(database, JWT secret, encryption key) are all read from .env.
The .env file is never committed to version control.
"""
import secrets
from pydantic import field_validator
from pydantic_settings import BaseSettings
from typing import List


class ServerSettings(BaseSettings):
    """
    Application settings.

    Values are read (in priority order) from:
      1. Real environment variables
      2. The .env file in the backend directory
      3. The defaults defined here

    Sensitive fields (DB_PASSWORD, JWT_SECRET, FIELD_ENCRYPTION_KEY) must be
    present in .env before the application starts, or will be auto-generated
    by :meth:`ensure_secrets` on first run.

    Development setup
    -----------------
    Add ``DEBUG=True`` to your local .env file to enable SQL echo, relaxed
    rate limits, and the /docs and /redoc endpoints.  Production deployments
    must NOT set DEBUG=True.
    """

    # --- Server ---
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    # Default is False (safe for production).  Set DEBUG=True in .env for dev.
    DEBUG: bool = False
    CORS_ORIGINS: List[str] = ["http://localhost:5173", "https://arkmania.it", "http://arkmania.it"]

    # --- Panel database (required — from .env) ---
    # Stores ArkManiaGest's own data: users, SSH machines, settings, server
    # instances, MariaDB instances, action log, scanned container cache.
    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_NAME: str = "arkmaniagest"
    DB_USER: str = "root"
    DB_PASSWORD: str = ""

    # --- Plugin database (optional — from .env) ---
    # Stores the game plugin data: ARKM_config / bans / rare_dinos /
    # transfer_rules / decay / leaderboard / players / sessions / event_log
    # and the native ARK tables (Players, ArkShopPlayers, PermissionGroups,
    # TribePermissions).  If any PLUGIN_DB_* is left empty the corresponding
    # panel DB_* value is used, so legacy single-database setups keep working.
    PLUGIN_DB_HOST: str = ""
    PLUGIN_DB_PORT: int = 0
    PLUGIN_DB_NAME: str = ""
    PLUGIN_DB_USER: str = ""
    PLUGIN_DB_PASSWORD: str = ""

    # --- Security (required — from .env) ---
    JWT_SECRET: str = ""           # 64 hex chars; auto-generated if empty
    FIELD_ENCRYPTION_KEY: str = "" # 64 hex chars (AES-256); auto-generated if empty

    # --- ServerForge (optional) ---
    SF_TOKEN: str = ""
    SF_BASE_URL: str = "https://serverforge.cx/api"

    # --- Public API (optional) ---
    PUBLIC_API_KEY: str = "ark_pub_7f3a9c2e1b5d4f8a6e0c3b7d9a1f5e2c"
    CRON_SECRET: str = "ark_cron_x9k4m2v7j8f1q3n6w5p0r"
    # Comma-separated origins allowed to call /api/v1/public/* endpoints.
    # Empty string disables origin checking (only API key + rate limit apply).
    PUBLIC_ALLOWED_ORIGINS: str = "https://arkmania.it,http://arkmania.it"
    # Comma-separated server IPs allowed to make unauthenticated server-side
    # requests (e.g. cron jobs).  Localhost is always included.
    PUBLIC_SERVER_IPS: str = ""

    # --- Optional ---
    ALLOWED_IPS: str = ""
    SSH_TIMEOUT: int = 30

    # --- Update checker ---
    # GitHub repository in "owner/repo" format.  The GET /settings/version-check
    # endpoint queries https://api.github.com/repos/<GITHUB_REPO>/releases/latest
    # to report whether a newer release is available.
    GITHUB_REPO: str = "Mrtritolo/ArkManiaGest"
    # Optional personal access token — only used to lift GitHub's anonymous
    # rate limit from 60 to 5000 requests per hour.  Leave empty for public
    # repos; the check still works unauthenticated.
    GITHUB_TOKEN: str = ""

    # --- Discord integration ------------------------------------------
    # See docs/DISCORD_INTEGRATION.md for the full rollout plan.
    # All these are optional: when CLIENT_ID + CLIENT_SECRET are blank,
    # the /auth/discord/* and /discord/* endpoints return HTTP 503 with
    # a "Discord not configured" hint instead of crashing.
    #
    # Where to find each value (Discord Developer Portal):
    #   * DISCORD_CLIENT_ID     — General Information -> Application ID
    #                             (public; used in OAuth URLs)
    #   * DISCORD_CLIENT_SECRET — OAuth2 -> Client Secret  (PRIVATE)
    #   * DISCORD_BOT_TOKEN     — Bot tab -> Token         (PRIVATE)
    #   * DISCORD_PUBLIC_KEY    — General Information -> Public Key
    #                             (public; only needed for HTTP-based
    #                              Interactions / slash commands)
    #   * DISCORD_GUILD_ID      — Discord client (Developer Mode on),
    #                             right-click the server -> Copy Server ID
    #   * DISCORD_REDIRECT_URI  — OAuth2 -> Redirects; must EXACTLY match
    #                             the value the panel sends.  Example:
    #                             https://gestionale.arkmania.it/auth/discord/callback
    DISCORD_CLIENT_ID:     str = ""
    DISCORD_CLIENT_SECRET: str = ""
    DISCORD_BOT_TOKEN:     str = ""
    DISCORD_PUBLIC_KEY:    str = ""
    DISCORD_GUILD_ID:      str = ""
    DISCORD_REDIRECT_URI:  str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True

    # ------------------------------------------------------------------
    # Input coercion
    # ------------------------------------------------------------------
    # Our installers write a single .env with every known key, emitting
    # empty strings for values the user did not provide (e.g. an unused
    # PLUGIN_DB_PORT or SSH_TIMEOUT).  Pydantic v2 would otherwise refuse
    # to parse "" into an int -- turn that into the field default instead
    # of crashing the service at boot.
    @field_validator(
        "API_PORT",
        "DB_PORT",
        "PLUGIN_DB_PORT",
        "SSH_TIMEOUT",
        mode="before",
    )
    @classmethod
    def _empty_int_to_default(cls, v, info):
        if isinstance(v, str) and v.strip() == "":
            default = cls.model_fields[info.field_name].default
            return default if default is not None else 0
        return v

    @field_validator("DEBUG", mode="before")
    @classmethod
    def _empty_bool_to_default(cls, v):
        # Same idea for DEBUG: accept empty string, treat as "not set".
        if isinstance(v, str) and v.strip() == "":
            return False
        return v

    @property
    def database_url(self) -> str:
        """Async SQLAlchemy connection string for the panel DB (aiomysql driver)."""
        return (
            f"mysql+aiomysql://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    @property
    def database_url_sync(self) -> str:
        """Synchronous SQLAlchemy connection string for the panel DB (pymysql driver)."""
        return (
            f"mysql+pymysql://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    # --- Plugin DB resolvers (fall back to panel DB if empty) -----------------

    @property
    def plugin_db_host(self) -> str:
        return self.PLUGIN_DB_HOST or self.DB_HOST

    @property
    def plugin_db_port(self) -> int:
        return self.PLUGIN_DB_PORT or self.DB_PORT

    @property
    def plugin_db_name(self) -> str:
        return self.PLUGIN_DB_NAME or self.DB_NAME

    @property
    def plugin_db_user(self) -> str:
        return self.PLUGIN_DB_USER or self.DB_USER

    @property
    def plugin_db_password(self) -> str:
        return self.PLUGIN_DB_PASSWORD or self.DB_PASSWORD

    @property
    def plugin_db_is_separate(self) -> bool:
        """True when the plugin DB points to a distinct host+db from the panel DB."""
        return (
            (self.plugin_db_host, self.plugin_db_port, self.plugin_db_name)
            != (self.DB_HOST, self.DB_PORT, self.DB_NAME)
        )

    @property
    def plugin_database_url(self) -> str:
        """Async SQLAlchemy connection string for the plugin DB."""
        return (
            f"mysql+aiomysql://{self.plugin_db_user}:{self.plugin_db_password}"
            f"@{self.plugin_db_host}:{self.plugin_db_port}/{self.plugin_db_name}"
        )

    def ensure_secrets(self) -> bool:
        """
        Generate JWT_SECRET and FIELD_ENCRYPTION_KEY if they are missing,
        then persist the new values to .env.

        Returns:
            True if .env was modified, False if both secrets already existed.
        """
        import os
        changed = False

        if not self.JWT_SECRET:
            self.JWT_SECRET = secrets.token_hex(32)
            changed = True

        if not self.FIELD_ENCRYPTION_KEY:
            self.FIELD_ENCRYPTION_KEY = secrets.token_hex(32)
            changed = True

        if changed:
            self._write_secrets_to_env()

        return changed

    def _write_secrets_to_env(self):
        """
        Write (or update) JWT_SECRET and FIELD_ENCRYPTION_KEY in .env.

        Existing lines for those keys are replaced; all other lines are kept.
        """
        import os

        env_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", ".env")
        )

        lines: list[str] = []
        if os.path.exists(env_path):
            with open(env_path, "r") as fh:
                for line in fh:
                    key = line.split("=")[0].strip() if "=" in line else ""
                    # Drop old values for these two keys; they will be re-added below
                    if key in ("JWT_SECRET", "FIELD_ENCRYPTION_KEY"):
                        continue
                    lines.append(line)

        if self.JWT_SECRET:
            lines.append(f"JWT_SECRET={self.JWT_SECRET}\n")
        if self.FIELD_ENCRYPTION_KEY:
            lines.append(f"FIELD_ENCRYPTION_KEY={self.FIELD_ENCRYPTION_KEY}\n")

        with open(env_path, "w") as fh:
            fh.writelines(lines)


# Module-level singleton — imported everywhere
server_settings = ServerSettings()
