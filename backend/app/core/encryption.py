"""
AES-256-GCM field encryption for sensitive database columns.

The encryption key is read from the ``FIELD_ENCRYPTION_KEY`` environment
variable (64 hex characters = 32 bytes).

Each encrypted value includes a random 12-byte GCM nonce, so the same
plaintext always produces a different ciphertext.

Storage format: base64(nonce || ciphertext || GCM-tag)
"""
import base64
import os
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# ── Constants ─────────────────────────────────────────────────────────────────
_REQUIRED_KEY_HEX_LEN = 64   # 64 hex chars = 32 bytes = AES-256
_NONCE_SIZE_BYTES = 12        # 96-bit nonce recommended for AES-GCM

_key: Optional[bytes] = None


def init_encryption(hex_key: str) -> None:
    """
    Initialise the module with the AES-256 key from the environment.

    Must be called once at application startup before any encrypt/decrypt call.

    Args:
        hex_key: Exactly 64 hexadecimal characters (32 bytes).

    Raises:
        ValueError: If *hex_key* is shorter than the required 64 characters.
    """
    global _key
    if not hex_key or len(hex_key) < _REQUIRED_KEY_HEX_LEN:
        raise ValueError(
            f"FIELD_ENCRYPTION_KEY must be at least {_REQUIRED_KEY_HEX_LEN} "
            "hexadecimal characters (256 bits)."
        )
    _key = bytes.fromhex(hex_key[:_REQUIRED_KEY_HEX_LEN])


def _ensure_initialised() -> None:
    """Raise RuntimeError if :func:`init_encryption` has not been called."""
    if not _key:
        raise RuntimeError(
            "Encryption not initialised. Call init_encryption() first."
        )


def encrypt_value(plaintext: str) -> str:
    """
    Encrypt *plaintext* and return a base64-encoded blob.

    The blob layout is: nonce (12 B) || ciphertext || GCM authentication tag.

    Args:
        plaintext: The UTF-8 string to encrypt.

    Returns:
        ASCII-safe base64 string, or an empty string if *plaintext* is empty.

    Raises:
        RuntimeError: If encryption has not been initialised.
    """
    _ensure_initialised()
    if not plaintext:
        return ""
    nonce = os.urandom(_NONCE_SIZE_BYTES)
    aesgcm = AESGCM(_key)          # type: ignore[arg-type]
    ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ct).decode("ascii")


def decrypt_value(encrypted: str) -> str:
    """
    Decrypt a value previously produced by :func:`encrypt_value`.

    Args:
        encrypted: Base64-encoded blob.

    Returns:
        Original plaintext string, or an empty string if *encrypted* is empty.

    Raises:
        RuntimeError: If encryption has not been initialised.
        Exception:    If the ciphertext is corrupted or the tag fails.
    """
    _ensure_initialised()
    if not encrypted:
        return ""
    raw = base64.b64decode(encrypted)
    nonce = raw[:_NONCE_SIZE_BYTES]
    ct = raw[_NONCE_SIZE_BYTES:]
    aesgcm = AESGCM(_key)          # type: ignore[arg-type]
    return aesgcm.decrypt(nonce, ct, None).decode("utf-8")


def is_encrypted(value: str) -> bool:
    """
    Heuristic check: return True if *value* looks like an encrypted blob.

    The check is intentionally lenient — it only validates that the string is
    valid base64 and long enough to contain at least a nonce.

    Args:
        value: String to inspect.

    Returns:
        True if *value* is likely encrypted, False otherwise.
    """
    if not value or len(value) < 30:
        return False
    try:
        raw = base64.b64decode(value)
        return len(raw) > _NONCE_SIZE_BYTES
    except Exception:
        return False


def generate_key() -> str:
    """Generate a new random AES-256 key as a 64-character hex string."""
    return os.urandom(32).hex()
