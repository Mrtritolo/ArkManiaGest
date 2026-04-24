"""
app.discord.store — CRUD layer for arkmaniagest_discord_accounts.

All access / refresh tokens travel through this module so the AES-GCM
encryption + decryption stays in one place.  The route layer never
sees a plaintext token unless it explicitly asks via
:func:`get_account_with_tokens`.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import decrypt_value, encrypt_value


# ── Internal helpers ─────────────────────────────────────────────────────────

def _row_to_account(row: dict, *, include_tokens: bool = False) -> dict:
    """Decrypt + ISO-format the row, optionally exposing the OAuth tokens."""
    m = dict(row)
    # Always decrypt so callers asking for tokens get them; strip them
    # afterwards when include_tokens=False so we don't leak by accident.
    access_enc  = m.pop("access_token_enc",  None)
    refresh_enc = m.pop("refresh_token_enc", None)
    if include_tokens:
        try:
            m["access_token"]  = decrypt_value(access_enc)  if access_enc  else None
        except Exception:
            m["access_token"] = None
        try:
            m["refresh_token"] = decrypt_value(refresh_enc) if refresh_enc else None
        except Exception:
            m["refresh_token"] = None

    for field in ("token_expires_at", "linked_at", "last_sync_at",
                  "created_at", "updated_at"):
        if m.get(field) and hasattr(m[field], "isoformat"):
            m[field] = m[field].isoformat()
    return m


# ── Reads ────────────────────────────────────────────────────────────────────

async def get_by_discord_id(
    db: AsyncSession,
    discord_user_id: str,
    *,
    include_tokens: bool = False,
) -> Optional[dict]:
    """Return the row for a given Discord snowflake, or None."""
    res = await db.execute(
        text("SELECT * FROM arkmaniagest_discord_accounts WHERE discord_user_id = :d"),
        {"d": str(discord_user_id)},
    )
    row = res.mappings().fetchone()
    return _row_to_account(dict(row), include_tokens=include_tokens) if row else None


async def get_by_eos_id(
    db: AsyncSession,
    eos_id: str,
    *,
    include_tokens: bool = False,
) -> Optional[dict]:
    """Return the row linked to a given EOS ID, or None."""
    res = await db.execute(
        text("SELECT * FROM arkmaniagest_discord_accounts WHERE eos_id = :e"),
        {"e": str(eos_id)},
    )
    row = res.mappings().fetchone()
    return _row_to_account(dict(row), include_tokens=include_tokens) if row else None


# ── Writes ───────────────────────────────────────────────────────────────────

async def upsert_discord_identity(
    db: AsyncSession,
    *,
    discord_user_id:    str,
    discord_username:   Optional[str],
    discord_global_name: Optional[str],
    discord_avatar:     Optional[str],
    access_token:       str,
    refresh_token:      str,
    expires_in:         int,
    scope:              Optional[str],
) -> dict:
    """
    Insert or refresh a row keyed by ``discord_user_id``.

    The Discord user can sign in MULTIPLE times before linking to a
    player -- every successful auth refreshes the profile fields and
    rotates the stored OAuth tokens.  ``eos_id`` is intentionally
    NEVER touched here so an existing link survives re-auth.

    Returns the decrypted-tokens row dict.
    """
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in or 0))
    access_enc  = encrypt_value(access_token)
    refresh_enc = encrypt_value(refresh_token) if refresh_token else None

    existing = await get_by_discord_id(db, discord_user_id)
    if existing:
        await db.execute(
            text(
                "UPDATE arkmaniagest_discord_accounts SET "
                "  discord_username    = :u, "
                "  discord_global_name = :g, "
                "  discord_avatar      = :a, "
                "  access_token_enc    = :at, "
                "  refresh_token_enc   = :rt, "
                "  token_expires_at    = :exp, "
                "  scope               = :sc "
                "WHERE discord_user_id = :d"
            ),
            {
                "u":   discord_username,
                "g":   discord_global_name,
                "a":   discord_avatar,
                "at":  access_enc,
                "rt":  refresh_enc,
                "exp": expires_at,
                "sc":  scope,
                "d":   str(discord_user_id),
            },
        )
    else:
        await db.execute(
            text(
                "INSERT INTO arkmaniagest_discord_accounts "
                "  (discord_user_id, discord_username, discord_global_name, "
                "   discord_avatar, access_token_enc, refresh_token_enc, "
                "   token_expires_at, scope) "
                "VALUES (:d, :u, :g, :a, :at, :rt, :exp, :sc)"
            ),
            {
                "d":   str(discord_user_id),
                "u":   discord_username,
                "g":   discord_global_name,
                "a":   discord_avatar,
                "at":  access_enc,
                "rt":  refresh_enc,
                "exp": expires_at,
                "sc":  scope,
            },
        )
    await db.commit()
    fresh = await get_by_discord_id(db, discord_user_id, include_tokens=True)
    assert fresh is not None
    return fresh


async def set_link(
    db: AsyncSession,
    *,
    discord_user_id: str,
    eos_id: Optional[str],
    linked_by_user_id: Optional[int] = None,
) -> dict:
    """
    Link or unlink a Discord account to an EOS ID.

    Pass ``eos_id=None`` to UNLINK.  Enforces 1:1 by attempting the
    UPDATE -- the UNIQUE index on eos_id will reject a double-link
    with an IntegrityError that the route layer turns into a 409.
    """
    now = datetime.now(timezone.utc)
    await db.execute(
        text(
            "UPDATE arkmaniagest_discord_accounts SET "
            "  eos_id            = :e, "
            "  linked_at         = :t, "
            "  linked_by_user_id = :u "
            "WHERE discord_user_id = :d"
        ),
        {
            "e": str(eos_id) if eos_id else None,
            "t": now if eos_id else None,
            "u": linked_by_user_id,
            "d": str(discord_user_id),
        },
    )
    await db.commit()
    fresh = await get_by_discord_id(db, discord_user_id)
    assert fresh is not None
    return fresh


async def get_by_app_user_id(
    db: AsyncSession,
    app_user_id: int,
    *,
    include_tokens: bool = False,
) -> Optional[dict]:
    """Return the row linked to a given AppUser.id, or None."""
    res = await db.execute(
        text("SELECT * FROM arkmaniagest_discord_accounts WHERE app_user_id = :u"),
        {"u": int(app_user_id)},
    )
    row = res.mappings().fetchone()
    return _row_to_account(dict(row), include_tokens=include_tokens) if row else None


async def set_app_user_link(
    db: AsyncSession,
    *,
    discord_user_id: str,
    app_user_id: Optional[int],
) -> dict:
    """
    Link or unlink a Discord identity to a panel AppUser.

    The UNIQUE index on app_user_id enforces 1:1 -- linking a Discord
    identity to an AppUser that's already tied to a different Discord
    account raises an IntegrityError that the route layer turns into
    a 409.
    """
    await db.execute(
        text(
            "UPDATE arkmaniagest_discord_accounts SET "
            "  app_user_id = :u "
            "WHERE discord_user_id = :d"
        ),
        {"u": int(app_user_id) if app_user_id else None, "d": str(discord_user_id)},
    )
    await db.commit()
    fresh = await get_by_discord_id(db, discord_user_id)
    assert fresh is not None
    return fresh


async def touch_last_sync(db: AsyncSession, discord_user_id: str) -> None:
    """Bump ``last_sync_at`` after a successful role reconciliation pass."""
    await db.execute(
        text(
            "UPDATE arkmaniagest_discord_accounts "
            "SET last_sync_at = :t WHERE discord_user_id = :d"
        ),
        {"t": datetime.now(timezone.utc), "d": str(discord_user_id)},
    )
    await db.commit()
