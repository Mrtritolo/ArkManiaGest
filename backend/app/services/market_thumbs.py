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

Storage: ``$ARKM_DATA_DIR/market_thumbs/<key>.png`` (see :func:`thumb_key`).  Defaults
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
from collections import deque
from pathlib import Path
from typing import Optional
from urllib.parse import quote

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
# Item icons are 5-30 KB; anything past this is not an icon and is neither
# held in memory nor cached.
_MAX_BYTES = 2 * 1024 * 1024
# Wiki fetches per minute for names that are not cached yet.  The endpoint is
# anonymous, so without a ceiling every made-up name costs a wiki request and
# a marker file, and a burst of them gets the panel's IP throttled by the wiki.
_FETCH_BUDGET_PER_MINUTE = 120
# Longest key that still fits a filename once ".png.tmp" is appended.
_MAX_KEY_LEN = 200


# ── Cache key ────────────────────────────────────────────────────────────────

_HAS_ALNUM_RE = re.compile(r"[A-Za-z0-9]")


def thumb_key(raw: str) -> str:
    """
    Map an item display name onto its cache key, which is ALSO the wiki
    file name fetched for it.

    Whitespace becomes ``_`` (MediaWiki treats the two alike) and every
    other character outside ``[A-Za-z0-9_-]`` is percent-encoded.  Using one
    string for both matters: while the key was a lossy sanitised copy of the
    name, ``Metal Ingot.`` fetched a missing file and wrote the negative
    marker of ``Metal Ingot``, and a ``?`` in the name turned the rest of the
    URL into a query string, so any wiki file could be pulled into the cache.

    Returns an empty string for a name with no letters or digits, or one too
    long for a filename -- callers treat empty as a 422.
    """
    canon = re.sub(r"\s+", "_", (raw or "").strip())
    if not _HAS_ALNUM_RE.search(canon):
        return ""
    key = quote(canon, safe="-_")
    return key if len(key) <= _MAX_KEY_LEN else ""


# ── Cache lookup + fetch ─────────────────────────────────────────────────────

# In-process lock per item-name so concurrent first-time requests for
# the same item don't race the wiki.  A lock is dropped as soon as nobody
# holds it, so the dict only holds the names being fetched right now.
_locks: dict[str, asyncio.Lock] = {}
_fetch_times: deque[float] = deque()


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


class TransientWikiError(Exception):
    """The image could not be fetched right now (wiki throttling, 5xx,
    timeout, or this process's own fetch budget is spent).

    Distinct from "the wiki has no such image": only the latter may be
    negative-cached. See :func:`_fetch_from_wiki`.
    """


def _take_fetch_slot() -> bool:
    """Count one wiki fetch against the per-minute budget; False once spent."""
    now = time.monotonic()
    while _fetch_times and now - _fetch_times[0] >= 60:
        _fetch_times.popleft()
    if len(_fetch_times) >= _FETCH_BUDGET_PER_MINUTE:
        return False
    _fetch_times.append(now)
    return True


async def _fetch_from_wiki(key: str) -> Optional[bytes]:
    """
    Pull the image from ark.wiki.gg's Special:FilePath redirect.

    *key* must come from :func:`thumb_key`: it is already URL-safe, so the
    requested file is always ``<key>.png`` and nothing else.

    Returns None ONLY when the wiki genuinely has no such image (404 /
    410 / a non-image 200 / a body over ``_MAX_BYTES``). Raises
    :class:`TransientWikiError` when the failure is momentary --
    throttling (429), server errors (5xx), or a connection-level problem --
    so the caller does not mistake it for a missing image and
    negative-cache it for 24h.

    That distinction matters: rendering a full shop catalogue fires
    dozens of thumb fetches at once, the wiki throttles the burst, and
    treating those responses as "no image" blanked out items that have
    perfectly good pictures until the marker expired.
    """
    url = f"https://ark.wiki.gg/wiki/Special:FilePath/{key}.png"
    body = bytearray()
    try:
        async with httpx.AsyncClient(
            timeout=_FETCH_TIMEOUT_SECONDS,
            follow_redirects=True,
            headers={"User-Agent": _USER_AGENT, "Accept": "image/*"},
        ) as client:
            async with client.stream("GET", url) as resp:
                if resp.status_code in (403, 429) or resp.status_code >= 500:
                    raise TransientWikiError(f"HTTP {resp.status_code}")
                if resp.status_code != 200:
                    return None
                if not resp.headers.get("content-type", "").startswith("image/"):
                    # Wiki sometimes returns an HTML error page with 200;
                    # discard those.
                    return None
                # Read with a cap: the real size is only known once read.
                async for chunk in resp.aiter_bytes():
                    body += chunk
                    if len(body) > _MAX_BYTES:
                        return None
    except httpx.HTTPError as exc:
        raise TransientWikiError(f"request failed: {exc}") from exc

    return bytes(body) or None


async def get_or_fetch_thumb(display_name: str) -> Optional[bytes]:
    """
    Public entry point used by the route layer.

    On cache hit: returns bytes immediately.
    On cache miss: locks per-name, fetches, writes (positive or
    negative cache), returns bytes (or None if the wiki had no image).

    Raises :class:`TransientWikiError` when the image could not be fetched
    right now; the caller must not answer with anything cacheable.
    """
    safe = thumb_key(display_name)
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
    try:
        async with lock:
            # Re-check inside the lock (another waiter might have warmed it)
            cached = _cached_bytes(safe)
            if cached is not None:
                return cached
            if _is_negative_cached(safe):
                return None

            if not _take_fetch_slot():
                raise TransientWikiError("fetch budget spent")
            try:
                data = await _fetch_from_wiki(safe)
            except TransientWikiError as exc:
                # Momentary failure: no negative marker, so the next render
                # retries instead of showing a blank tile for 24h.
                log.warning("market_thumbs: wiki unavailable for %r: %s", display_name, exc)
                raise
            except Exception as exc:                                # noqa: BLE001
                log.warning("market_thumbs: wiki fetch failed for %r: %s", display_name, exc)
                raise TransientWikiError(str(exc)) from exc

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
    finally:
        # Nobody holds it any more: forget it.  A waiter woken just now keeps
        # its own reference and re-checks the cache before fetching.
        if not lock.locked() and _locks.get(safe) is lock:
            del _locks[safe]
