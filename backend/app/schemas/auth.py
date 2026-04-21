"""
schemas/auth.py — Pydantic request/response schemas for authentication
and user account management.
"""

from typing import Optional
from pydantic import BaseModel, Field


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
    password: str = Field(..., min_length=6)
    display_name: str = Field(..., min_length=1, max_length=100)
    role: str = Field(..., pattern=r"^(admin|operator|viewer)$")


class UserUpdate(BaseModel):
    """Fields that can be updated on an existing user account (all optional)."""

    display_name: Optional[str] = Field(None, max_length=100)
    role: Optional[str] = Field(None, pattern=r"^(admin|operator|viewer)$")
    active: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=6)


class ChangeOwnPasswordRequest(BaseModel):
    """Payload for the change-own-password endpoint."""

    old_password: str
    new_password: str = Field(..., min_length=6)
