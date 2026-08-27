"""
services/map_images.py — local cache of ARK topographic map images.

The player map draws object dots over the real in-game map. The images live
on ark.wiki.gg, but hotlinking them at render time is a bad deal: the wiki
rate-limits per IP (we tripped 429s within a handful of requests while
picking the URLs) and some maps are large — Lost Island alone is 6 MB. A
page that refetched them on every load would be both fragile and rude.

So we fetch each map once, keep it on disk, and serve it from the panel.

Storage: ``$ARKM_DATA_DIR/map_images/<Map_Name>.jpg``, defaulting to
``backend/data/map_images/`` — the same convention as market_thumbs, so a
production deploy that points ARKM_DATA_DIR at a volume keeps both caches
across rebuilds.

Only maps in ``WIKI_FILENAMES`` are fetchable: the name reaching the wiki is
never taken from the request, so no caller can point this at an arbitrary
URL or walk out of the cache directory.
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Optional

import httpx

log = logging.getLogger("arkmaniagest.map.images")

_FETCH_TIMEOUT_SECONDS = 30.0          # 6 MB over a slow hop needs room
_NEGATIVE_TTL_SECONDS = 3_600          # re-try a failed fetch after an hour
_MAX_BYTES = 20 * 1024 * 1024
_USER_AGENT = "ArkManiaGest-Panel/1.0 (https://gestionale.arkmania.it)"
_FILEPATH_URL = "https://ark.wiki.gg/wiki/Special:FilePath/{filename}"

# map_name reported by the plugin  ->  wiki file name.
#
# Special:FilePath resolves the canonical file regardless of the storage
# hash, so these stay valid when the wiki reorganises its uploads.
# Verified reachable: The Island, Scorched Earth, Aberration, Extinction,
# Valguero, Ragnarok, Lost Island. The rest follow the same naming rule but
# were still rate-limited when checked; a 429 is cached only briefly, so
# they resolve on a later attempt.
#
# Mod maps (Astraeos, Lost City, Lost Colony, BobsMissions) are absent on
# purpose: the wiki has no topographic image under a predictable name, and
# a wrong guess would draw dots over the WRONG map, which is worse than no
# background. Add them here (or override) once you have a real image.
WIKI_FILENAMES: dict[str, str] = {
    "TheIsland_WP":     "The_Island_Topographic_Map.jpg",
    "ScorchedEarth_WP": "Scorched_Earth_Topographic_Map.jpg",
    "Aberration_WP":    "Aberration_Topographic_Map.jpg",
    "Extinction_WP":    "Extinction_Topographic_Map.jpg",
    "Valguero_WP":      "Valguero_Topographic_Map.jpg",
    "Ragnarok_WP":      "Ragnarok_Topographic_Map.jpg",
    "TheCenter_WP":     "The_Center_Topographic_Map.jpg",
    "Genesis_WP":       "Genesis_Part_1_Topographic_Map.jpg",
    "LostIsland_WP":    "Lost_Island_Topographic_Map.jpg",
    "Fjordur_WP":       "Fjordur_Topographic_Map.jpg",
}


def _resolve_dir() -> Path:
    override = os.environ.get("ARKM_DATA_DIR")
    base = (Path(override).expanduser().resolve() if override
            else (Path(__file__).resolve().parents[2] / "data").resolve())
    target = base / "map_images"
    target.mkdir(parents=True, exist_ok=True)
    return target


_DIR = _resolve_dir()


def _cached_path(map_name: str) -> Optional[Path]:
    filename = WIKI_FILENAMES.get(map_name)
    if not filename:
        return None
    return _DIR / filename


def _failure_marker(map_name: str) -> Path:
    return _DIR / f"{map_name}.failed"


def is_supported(map_name: str) -> bool:
    """True when we know a wiki image for this map."""
    return map_name in WIKI_FILENAMES


async def get_map_image(map_name: str) -> Optional[Path]:
    """
    Return the on-disk path of the map image, fetching it once if needed.

    ``None`` when the map has no known image or the fetch failed; callers
    should render the map without a background rather than erroring, so a
    wiki outage degrades the view instead of breaking the page.
    """
    path = _cached_path(map_name)
    if path is None:
        return None
    if path.is_file() and path.stat().st_size > 0:
        return path

    marker = _failure_marker(map_name)
    if marker.is_file() and (time.time() - marker.stat().st_mtime) < _NEGATIVE_TTL_SECONDS:
        return None

    url = _FILEPATH_URL.format(filename=WIKI_FILENAMES[map_name])
    try:
        async with httpx.AsyncClient(
            timeout=_FETCH_TIMEOUT_SECONDS,
            follow_redirects=True,
            headers={"User-Agent": _USER_AGENT, "Accept": "image/*"},
        ) as client:
            resp = await client.get(url)
        if resp.status_code != 200 or not resp.content:
            log.warning("map_images: %s -> HTTP %s", map_name, resp.status_code)
            marker.touch()
            return None
        if not resp.headers.get("content-type", "").startswith("image/"):
            log.warning("map_images: %s -> non-image content-type", map_name)
            marker.touch()
            return None
        if len(resp.content) > _MAX_BYTES:
            log.warning("map_images: %s -> %d bytes, over cap", map_name, len(resp.content))
            marker.touch()
            return None
        # Write via a temp file so a crash mid-download cannot leave a
        # truncated image that would then be served forever as "cached".
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_bytes(resp.content)
        tmp.replace(path)
        if marker.is_file():
            marker.unlink(missing_ok=True)
        log.info("map_images: cached %s (%d bytes)", map_name, len(resp.content))
        return path
    except Exception as exc:
        log.warning("map_images: fetch failed for %s: %s", map_name, exc)
        marker.touch()
        return None
