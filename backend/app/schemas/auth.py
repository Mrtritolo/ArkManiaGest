"""
schemas/auth.py — Pydantic request/response schemas for authentication
and user account management.
"""

from typing import Optional
from pydantic import BaseModel, Field, field_validator


def validate_password_strength(value: str) -> str:
    """
    Shared password-complexity rule (NIS2 hardening): at least one letter
    and one digit on top of the per-field minimum length.  Login is NOT
    validated with this (existing accounts must keep working); it applies
    to every path that SETS a password.

    bcrypt only uses the first 72 bytes and bcrypt 5 raises past that, so a
    longer password is rejected here (422) instead of failing as a 500.
    """
    if len(value.encode("utf-8")) > 72:
        raise ValueError("Password must be at most 72 bytes (fewer characters if accented).")
    if not any(c.isalpha() for c in value) or not any(c.isdigit() for c in value):
        raise ValueError("Password must contain at least one letter and one digit.")
    return value


def strip_whitespace(value):
    """
    ``mode="before"`` validator: strip a string before the length checks
    run, so a blank or whitespace-only name fails ``min_length`` instead of
    being stripped to "" by the route afterwards.
    """
    return value.strip() if isinstance(value, str) else value


class LoginRequest(BaseModel):
    """Credentials submitted to the login endpoint."""

    username: str = Field(..., min_length=2, max_length=50)
    password: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    """Successful login response containing the JWT and user profile."""

    token: str
    user: "UserRead"


class UserRead(BaseModel):
    """Public user profile (password hash excluded)."""

    id: int
    username: str
    display_name: str
    role: str
    active: bool = True
    created_at: Optional[str] = None
    last_login: Optional[str] = None


class UserCreate(BaseModel):
    """Fields required to create a new user account."""

    username: str = Field(
        ...,
        min_length=2,
        max_length=50,
        pattern=r"^[a-zA-Z0-9_.\-]+$",
        description="Alphanumeric username (letters, digits, underscore, dot, hyphen).",
    )
    password: str = Field(..., min_length=12)
    display_name: str = Field(..., min_length=1, max_length=100)
    role: str = Field(..., pattern=r"^(admin|operator|viewer)$")

    _password_strength = field_validator("password")(validate_password_strength)
    _strip_display_name = field_validator("display_name", mode="before")(strip_whitespace)


class UserUpdate(BaseModel):
    """Fields that can be updated on an existing user account (all optional)."""

    display_name: Optional[str] = Field(None, min_length=1, max_length=100)
    role: Optional[str] = Field(None, pattern=r"^(admin|operator|viewer)$")
    active: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=12)

    _strip_display_name = field_validator("display_name", mode="before")(strip_whitespace)

    @field_validator("display_name", "role", "active", "password", mode="before")
    @classmethod
    def _reject_explicit_null(cls, v):
        # Omitting a field leaves it unchanged (the route dumps with
        # exclude_unset); an explicit null would reach update_user as NULL
        # on a NOT NULL column (or hash None) and fail as a 500.
        if v is None:
            raise ValueError("Field cannot be null; omit it to leave it unchanged.")
        return v

    @field_validator("password")
    @classmethod
    def _password_strength(cls, v: Optional[str]) -> Optional[str]:
        return validate_password_strength(v) if v is not None else v


class ChangeOwnPasswordRequest(BaseModel):
    """Payload for the change-own-password endpoint."""

    old_password: str
    new_password: str = Field(..., min_length=12)

    _password_strength = field_validator("new_password")(validate_password_strength)
