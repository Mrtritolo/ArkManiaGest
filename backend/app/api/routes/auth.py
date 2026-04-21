"""
api/routes/auth.py — Authentication and user-management endpoints.

Public endpoints (no JWT required):
    POST /auth/login         — Authenticate and receive a signed JWT
    GET  /auth/me            — Return the current user's profile
    PUT  /auth/me/password   — Change the current user's own password

Admin-only endpoints:
    GET    /users            — List all user accounts
    POST   /users            — Create a new user account
    PUT    /users/{id}       — Update a user account
    DELETE /users/{id}       — Delete a user account
"""
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.auth import (
    hash_password,
    verify_password,
    create_token,
    get_current_user,
    require_admin,
)
from app.core.store import (
    get_user_by_username,
    get_user_by_id,
    get_all_users,
    create_user,
    update_user,
    delete_user,
)
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    UserRead,
    UserCreate,
    UserUpdate,
    ChangeOwnPasswordRequest,
)

router = APIRouter()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _user_to_read(user: dict) -> UserRead:
    """
    Convert a store-layer user dict to the public :class:`UserRead` schema.

    The password hash is intentionally excluded.

    Args:
        user: Full user dict as returned by the store functions.

    Returns:
        :class:`~app.schemas.auth.UserRead` instance.
    """
    return UserRead(
        id=user["id"],
        username=user["username"],
        display_name=user.get("display_name", user["username"]),
        role=user["role"],
        active=bool(user.get("active", True)),
        created_at=str(user["created_at"]) if user.get("created_at") else None,
        last_login=str(user["last_login"]) if user.get("last_login") else None,
    )


# ── Authentication ────────────────────────────────────────────────────────────

@router.post("/auth/login", response_model=LoginResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Authenticate a user and return a signed JWT.

    Both "user not found" and "wrong password" cases return HTTP 401 with the
    same generic message to prevent username enumeration attacks.
    """
    user = await get_user_by_username(db, req.username)

    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    if not user.get("active", True):
        raise HTTPException(status_code=401, detail="Account is disabled.")

    if not verify_password(req.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    now = datetime.now(timezone.utc)
    await update_user(db, user["id"], {"last_login": now})

    token = create_token(user["username"], user["role"])

    return LoginResponse(
        token=token,
        user=UserRead(
            id=user["id"],
            username=user["username"],
            display_name=user.get("display_name", user["username"]),
            role=user["role"],
            active=bool(user.get("active", True)),
            created_at=str(user["created_at"]) if user.get("created_at") else None,
            last_login=now.isoformat(),
        ),
    )


@router.get("/auth/me", response_model=UserRead)
async def get_me(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the profile of the currently authenticated user."""
    user = await get_user_by_username(db, current_user["sub"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return _user_to_read(user)


@router.put("/auth/me/password")
async def change_own_password(
    req: ChangeOwnPasswordRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Allow the current user to change their own password."""
    user = await get_user_by_username(db, current_user["sub"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    if not verify_password(req.old_password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")

    await update_user(db, user["id"], {"password_hash": hash_password(req.new_password)})
    return {"success": True, "message": "Password updated."}


# ── User management (admin only) ──────────────────────────────────────────────

@router.get("/users", response_model=List[UserRead])
async def list_users(
    _admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return all user accounts (admin only)."""
    users = await get_all_users(db)
    return [_user_to_read(u) for u in users]


@router.post("/users", response_model=UserRead, status_code=201)
async def create_user_route(
    req: UserCreate,
    _admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new user account (admin only).

    Raises:
        HTTPException 409: The requested username is already taken.
    """
    normalised_username = req.username.lower().strip()
    existing = await get_user_by_username(db, normalised_username)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Username '{req.username}' is already taken.",
        )

    user_data = {
        "username":      normalised_username,
        "password_hash": hash_password(req.password),
        "display_name":  req.display_name.strip(),
        "role":          req.role,
        "active":        True,
        "created_at":    datetime.now(timezone.utc),
    }
    created = await create_user(db, user_data)
    return _user_to_read(created)


@router.put("/users/{user_id}", response_model=UserRead)
async def update_user_route(
    user_id: int,
    req: UserUpdate,
    _admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Update a user account (admin only).

    A new password included in the request is hashed before storage.
    """
    updates = req.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update.")

    # Hash the new password before passing it to the store layer
    if "password" in updates:
        updates["password_hash"] = hash_password(updates.pop("password"))

    updated = await update_user(db, user_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
    return _user_to_read(updated)


@router.delete("/users/{user_id}")
async def delete_user_route(
    user_id: int,
    admin: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a user account (admin only).

    Two safety guards prevent accidental data loss:
      - An admin cannot delete their own account.
      - The last remaining active admin account cannot be deleted.
    """
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    if user["username"] == admin["sub"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")

    # Protect the last admin
    all_users = await get_all_users(db)
    active_admins = [u for u in all_users if u["role"] == "admin" and u.get("active", True)]
    if user["role"] == "admin" and len(active_admins) <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the last admin account.",
        )

    await delete_user(db, user_id)
    return {"success": True, "message": f"User '{user['username']}' deleted."}
