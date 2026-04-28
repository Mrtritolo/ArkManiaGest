"""
services/market_thumbs.py — local cache of ARK item images (Phase 8 GUI).

Fetches ``Special:FilePath/<name>.png`` from ark.wiki.gg the FIRST
time an item appears on the marketplace dashboard, then serves every
subsequent request from local disk.

Why this lives in the backend instead of pointing the browser at the
wiki directly:

  - The CSP for the panel is ``img-src 'self' data: cdn.discordapp.com``;
    adding ark.wiki.gg means relaxing the policy for the whole app.
  - Wiki page slugs change occasionally (rename, redirect chains)
    which would break dozens of marketplace cards at once with no
    server-side knob.  A local cache decouples us from those drifts.
  - Cold latency to the wiki is ~300-800 ms; second-hop browser
    requests against our own nginx are <10 ms.

Storage: ``$ARKM_DATA_DIR/market_thumbs/<sanitised>.png``.  Defaults
to ``backend/data/market_thumbs/`` next to the package.  ~5-30 KB
per image; 100 distinct items = 0.5-3 MB.

A negative-cache file (zero-byte ``.404``) is written when the wiki
returns 404 so we don't keep hammering it for items that don't have
a wiki page (mod items, removed content).
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional

import httpx


log = logging.getLogger("arkmaniagest.market.thumbs")


# ── Storage location ─────────────────────────────────────────────────────────

def _resolve_thumb_dir() -> Path:
    """
    Resolve the on-disk cache directory.  Override via the
    ``ARKM_DATA_DIR`` env var (production deploys put this on a
    persistent volume so cached thumbs survive container rebuilds).
    """
    override = os.environ.get("ARKM_DATA_DIR")
    if override:
        base = Path(override).expanduser().resolve()
    else:
        # backend/app/services/market_thumbs.py  -->  backend/data/market_thumbs
        base = (Path(__file__).resolve().parents[2] / "data").resolve()
    target = base / "market_thumbs"
    target.mkdir(parents=True, exist_ok=True)
    return target


_THUMB_DIR = _resolve_thumb_dir()
_NEGATIVE_TTL_SECONDS = 86_400  # re-try a 404 after 24h
_FETCH_TIMEOUT_SECONDS = 8.0
_USER_AGENT = "ArkManiaGest-Panel/1.0 (https://gestionale.arkmania.it)"


# ── Filename sanitisation ────────────────────────────────────────────────────

_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9_\- ]")


def sanitize_thumb_name(raw: str) -> str:
    """
    Map an item display name onto a filesystem-safe key.

    Strategy:
      - Strip everything except alphanumerics, ``_``, ``-`` and spaces.
      - Collapse runs of whitespace into a single ``_``.
      - Trim length to 96 chars (well below most filesystems' 255).

    Returns an empty string for input that contains no usable
    characters -- callers should treat empty as a 422.
    """
    cleaned = _SAFE_NAME_RE.sub("", (raw or "")).strip()
    cleaned = re.sub(r"\s+", "_", cleaned)
    return cleaned[:96]


# ── Cache lookup + fetch ─────────────────────────────────────────────────────

# In-process lock per item-name so concurrent first-time requests for
# the same item don't race the wiki.  Bounded LRU-ish: we never bother
# evicting because the lock dict only holds names that have been
# requested at least once -- typical cap = a few hundred entries.
_locks: dict[str, asyncio.Lock] = {}


def _path_for(safe_name: str) -> Path:
    return _THUMB_DIR / f"{safe_name}.png"


def _negative_path_for(safe_name: str) -> Path:
    return _THUMB_DIR / f"{safe_name}.404"


def _cached_bytes(safe_name: str) -> Optional[bytes]:
    """Return the cached image bytes, or None when absent / negative-cached."""
    p = _path_for(safe_name)
    if p.exists() and p.stat().st_size > 0:
        try:
            return p.read_bytes()
        except OSError:
            return None
    neg = _negative_path_for(safe_name)
    if neg.exists():
        # Honour the TTL: when expired, allow a re-fetch by deleting
        # the marker (best-effort).
        if (time.time() - neg.stat().st_mtime) > _NEGATIVE_TTL_SECONDS:
            try: neg.unlink(missing_ok=True)
            except OSError: pass
    return None


def _is_negative_cached(safe_name: str) -> bool:
    """
    True when a fresh ``.404`` marker exists for *safe_name*.

    Exists separately from :func:`_cached_bytes` because a negative
    cache hit must short-circuit ``get_or_fetch_thumb`` BEFORE the
    slow-path wiki fetch -- otherwise we re-hammer the wiki on every
    request even when we already know the page is missing.
    """
    neg = _negative_path_for(safe_name)
    if not neg.exists():
        return False
    if (time.time() - neg.stat().st_mtime) > _NEGATIVE_TTL_SECONDS:
        # Stale marker; let the caller refresh it.
        try: neg.unlink(missing_ok=True)
        except OSError: pass
        return False
    return True


async def _fetch_from_wiki(display_name: str) -> Optional[bytes]:
    """
    Pull the image from ark.wiki.gg's Special:FilePath redirect.

    Returns None when the wiki responds 404 / 410 / etc.; raises only
    on connection-level failures (caller logs + treats as miss).
    """
    url = f"https://ark.wiki.gg/wiki/Special:FilePath/{display_name}.png"
    async with httpx.AsyncClient(
        timeout=_FETCH_TIMEOUT_SECONDS,
        follow_redirects=True,
        headers={"User-Agent": _USER_AGENT, "Accept": "image/*"},
    ) as client:
        resp = await client.get(url)
        if resp.status_code == 200 and resp.content:
            ctype = resp.headers.get("content-type", "")
            if not ctype.startswith("image/"):
                # Wiki sometimes returns an HTML error page with 200;
                # discard those.
                return None
            return resp.content
        return None


async def get_or_fetch_thumb(display_name: str) -> Optional[bytes]:
    """
    Public entry point used by the route layer.

    On cache hit: returns bytes immediately.
    On cache miss: locks per-name, fetches, writes (positive or
    negative cache), returns bytes (or None if the wiki had no image).
    """
    safe = sanitize_thumb_name(display_name)
    if not safe:
        return None

    # Fast path: already cached.
    cached = _cached_bytes(safe)
    if cached is not None:
        return cached

    # Negative cache: known-404 within TTL -- bail without touching
    # the wiki.  This is the hot path for big catalogs that contain
    # hundreds of names the wiki has no page for (admin commands,
    # mod-only items, emote variants).
    if _is_negative_cached(safe):
        return None

    # Slow path: lock + fetch.  The lock makes sure two concurrent
    # requests for the same brand-new item only hit the wiki once.
    lock = _locks.setdefault(safe, asyncio.Lock())
    async with lock:
        # Re-check inside the lock (another waiter might have warmed it)
        cached = _cached_bytes(safe)
        if cached is not None:
            return cached
        if _is_negative_cached(safe):
            return None

        try:
            data = await _fetch_from_wiki(display_name)
        except Exception as exc:                                # noqa: BLE001
            log.warning("market_thumbs: wiki fetch failed for %r: %s", display_name, exc)
            return None

        if not data:
            # Drop a negative marker so we don't re-fetch for 24h.
            try:
                _negative_path_for(safe).touch()
            except OSError:
                pass
            return None

        # Persist atomically: write tmp + rename.
        path = _path_for(safe)
        tmp  = path.with_suffix(".png.tmp")
        try:
            tmp.write_bytes(data)
            os.replace(tmp, path)
        except OSError as exc:
            log.warning("market_thumbs: write failed for %r: %s", display_name, exc)
            try: tmp.unlink(missing_ok=True)
            except OSError: pass
            return data  # serve from memory even if disk persist failed

        return data
