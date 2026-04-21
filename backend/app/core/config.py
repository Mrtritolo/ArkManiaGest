"""
Server configuration loaded from environment variables / .env file.

Bootstrap parameters (host, port, CORS, debug mode) and sensitive credentials
(database, JWT secret, encryption key) are all read from .env.
The .env file is never committed to version control.
"""
import secrets
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

    # --- Database (required — from .env) ---
    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_NAME: str = "arkmaniagest"
    DB_USER: str = "root"
    DB_PASSWORD: str = ""

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

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True

    @property
    def database_url(self) -> str:
        """Async SQLAlchemy connection string (aiomysql driver)."""
        return (
            f"mysql+aiomysql://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    @property
    def database_url_sync(self) -> str:
        """Synchronous SQLAlchemy connection string (pymysql driver)."""
        return (
            f"mysql+pymysql://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
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
