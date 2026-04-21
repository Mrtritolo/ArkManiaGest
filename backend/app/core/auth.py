"""
Authentication helpers — JWT creation/validation and bcrypt password hashing.

Users are stored in the database (arkmaniagest_users table).
JWTs expire after 24 hours; the signing secret comes from .env.
"""
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
import bcrypt
from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import server_settings

# ── Constants ─────────────────────────────────────────────────────────────────
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24
ROLES = ("admin", "operator", "viewer")

_bearer_scheme = HTTPBearer(auto_error=False)


# =============================================
#  Password hashing (bcrypt)
# =============================================

def hash_password(password: str) -> str:
    """Return a bcrypt hash of *password*."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """
    Check whether *password* matches the stored *hashed* value.

    Returns False on any exception (e.g. malformed hash) rather than raising.
    """
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# =============================================
#  JWT helpers
# =============================================

def _get_jwt_secret() -> str:
    """Return the JWT signing secret from configuration.

    Raises:
        RuntimeError: If JWT_SECRET is not set in .env.
    """
    secret = server_settings.JWT_SECRET
    if not secret:
        raise RuntimeError("JWT_SECRET is not configured in .env")
    return secret


def create_token(username: str, role: str, hours: int = JWT_EXPIRY_HOURS) -> str:
    """
    Create a signed JWT for the given *username* and *role*.

    Args:
        username: The user's login name (used as the ``sub`` claim).
        role:     One of ``admin``, ``operator``, or ``viewer``.
        hours:    Token lifetime in hours (default: 24).

    Returns:
        A compact JWT string.
    """
    secret = _get_jwt_secret()
    payload = {
        "sub": username,
        "role": role,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=hours),
        "jti": secrets.token_hex(8),  # unique token ID (prevents token reuse)
    }
    return jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """
    Decode and validate a JWT.

    Args:
        token: Raw JWT string from the Authorization header.

    Returns:
        The decoded payload dict (contains ``sub``, ``role``, etc.).

    Raises:
        HTTPException 401: Token is expired or invalid.
    """
    secret = _get_jwt_secret()
    try:
        return jwt.decode(token, secret, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired. Please log in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token.")


def generate_jwt_secret() -> str:
    """Generate a cryptographically random JWT secret (64 hex chars)."""
    return secrets.token_hex(32)


# =============================================
#  FastAPI dependencies
# =============================================

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> dict:
    """
    FastAPI dependency: extract and validate the current user from the JWT.

    Also verifies that the user still exists and is active in the database.

    Returns:
        The decoded JWT payload: ``{"sub": username, "role": ..., ...}``

    Raises:
        HTTPException 401: Missing/invalid token or deactivated user.
        HTTPException 500: Database unavailable.
    """
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required.")

    payload = decode_token(credentials.credentials)

    # Verify the user still exists and has not been deactivated
    from app.db.session import _async_session
    if _async_session is None:
        raise HTTPException(status_code=500, detail="Database unavailable.")

    from app.core.store import get_user_by_username
    async with _async_session() as db:
        user = await get_user_by_username(db, payload["sub"])
        if not user or not user.get("active", True):
            raise HTTPException(status_code=401, detail="User disabled or not found.")

    return payload


def require_role(*roles: str):
    """
    FastAPI dependency factory: allow access only to users with one of *roles*.

    Usage::

        @router.get("/admin-only")
        async def endpoint(user: dict = Depends(require_role("admin"))):
            ...

    Args:
        *roles: One or more role names that are permitted.

    Returns:
        An async dependency function that validates the role and returns the
        decoded JWT payload.
    """
    async def _check(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied. Required role: {', '.join(roles)}",
            )
        return user
    return _check


# Convenience shortcuts for the most common role combinations
require_admin    = require_role("admin")
require_operator = require_role("admin", "operator")
require_viewer   = require_role("admin", "operator", "viewer")
