"""
services/cryopod_parser.py — Extract dino metadata from a cryopod's
ItemSerializer blob (Phase 8 GUI).

Cryopod items captured by the C++ ARKM-Marketplace plugin embed the
dino character's data in the FItemNetInfo custom-data section.  When
the plugin doesn't pre-populate dedicated DB columns, the panel can
still surface the readable bits (name, level, stats string, gender,
colors) by parsing the binary blob lazily.

The same FString-walking technique used by ``app.ssh.ark_parse_profile``
applies here: positive 4-byte length prefix -> N bytes UTF-8,
negative -> -N pairs UTF-16-LE.  Inside a cryopod blob we look for:

  - ``<DinoName>_Character_BP_C_<id>``      -> dino BP class
  - ``<DinoName> - Lvl <N> (<Species>)``    -> display name + level
  - ``\\d+,\\d+,\\d+,\\d+,\\d+,\\d+,?``     -> stat distribution string
  - ``MALE`` / ``FEMALE``                   -> gender
  - ``/Game/.../Dinos/.../<DinoName>_Character_BP``
                                            -> wiki species name

The parser is best-effort: every field defaults to None when the
pattern doesn't match.  Callers should treat the result as a hint,
not as authoritative data.
"""

from __future__ import annotations

import base64
import logging
import re
import struct
import zlib
from dataclasses import dataclass
from typing import Iterable, Optional


log = logging.getLogger("arkmaniagest.market.cryopod")


# Reuse the same FString constraints as the .arkprofile parser.
_FSTRING_MIN_LEN = 3
_FSTRING_MAX_LEN = 512


@dataclass
class CryopodInfo:
    """Best-effort extraction of dino data from a cryopod blob."""
    dino_blueprint:    Optional[str] = None   # full /Game/.../X_Character_BP_C path
    dino_class:        Optional[str] = None   # X_Character_BP_C bare class name
    dino_species:      Optional[str] = None   # 'Moschops' / 'Rex' / ...
    dino_display_name: Optional[str] = None   # 'Moschops - Lvl 197 (Moschops)'
    dino_level:        Optional[int] = None   # 197
    dino_stats:        Optional[str] = None   # '35,13,24,20,33,8,'
    dino_gender:       Optional[str] = None   # 'MALE' | 'FEMALE'
    dino_colors:       list[str] = None       # color region names list (best-effort)


# ── FString walker (same algorithm as ark_parse_profile.extract_fstrings) ───

def _is_printable_text(s: str) -> bool:
    """
    Strict-enough printable check used to drop binary-noise that
    happens to satisfy the length prefix.  We require every char
    to be either alphanumeric, ASCII punctuation or whitespace.
    """
    if not s:
        return False
    return all(
        c.isalnum() or c.isspace() or c in "_-./,;:()[]{}'\"!?@#%&*+=<>~|\\"
        for c in s
    )


def _walk_fstrings(data: bytes) -> Iterable[str]:
    """
    Yield every plausible FString in ``data`` in file order.

    Cryopod blobs use a length-prefixed format WITHOUT the UE4 null
    terminator that .arkprofile files have.  We decode regardless and
    filter on a stricter printable-text check to drop binary garbage
    that happens to look like a valid length prefix.
    """
    pos = 0
    n = len(data)
    while pos < n - 4:
        try:
            (length,) = struct.unpack_from("<i", data, pos)
        except struct.error:
            return

        # UTF-8 (positive length)
        if _FSTRING_MIN_LEN < length < _FSTRING_MAX_LEN:
            end = pos + 4 + length
            if end <= n:
                raw = data[pos + 4:end]
                # Trim a trailing null when present (.arkprofile style)
                if raw.endswith(b"\x00"):
                    raw = raw[:-1]
                try:
                    decoded = raw.decode("utf-8", errors="strict")
                    if len(decoded) >= _FSTRING_MIN_LEN and _is_printable_text(decoded):
                        yield decoded
                        pos = end
                        continue
                except UnicodeDecodeError:
                    pass

        # UTF-16-LE (negative length)
        elif -_FSTRING_MAX_LEN < length < -_FSTRING_MIN_LEN:
            byte_count = (-length) * 2
            end = pos + 4 + byte_count
            if end <= n:
                raw = data[pos + 4:end]
                try:
                    decoded = raw.decode("utf-16-le", errors="strict").rstrip("\x00")
                    if len(decoded) >= _FSTRING_MIN_LEN and _is_printable_text(decoded):
                        yield decoded
                        pos = end
                        continue
                except UnicodeDecodeError:
                    pass

        pos += 1


# ── Pattern matchers ─────────────────────────────────────────────────────────

_RE_DINO_DISPLAY = re.compile(
    r"^(?P<name>[^()]+?)\s*-\s*Lvl\s+(?P<lvl>\d+)\s*\((?P<species>[^()]+)\)\s*$"
)
_RE_DINO_CLASS = re.compile(r"^([A-Za-z][A-Za-z0-9_]*?)_Character_BP_C(?:_\d+)?$")
_RE_STATS = re.compile(r"^\d+(?:,\d+){5,9},?$")
_RE_GENDER = re.compile(r"^(MALE|FEMALE)$")
_RE_DINO_BP_PATH = re.compile(
    r"/Game/.*?/Dinos/[^/]+/([A-Za-z][A-Za-z0-9_]*?)_Character_BP\.\1_Character_BP_C$"
)


# ── Public entry point ──────────────────────────────────────────────────────

def parse_cryopod_blob(item_data_b64: str) -> Optional[CryopodInfo]:
    """
    Decode the base64 blob the C++ plugin stores in
    ``ARKM_market_items.item_data`` and pull the dino metadata.

    Returns None when the blob can't be decoded; otherwise a
    :class:`CryopodInfo` with whatever fields could be matched.

    Cheap to call: O(len(blob)) FString walk + a handful of regex
    matches.  ~1-3 ms per blob in practice.
    """
    if not item_data_b64:
        return None
    # base64 in DB rows occasionally arrives with 1-3 stripped chars from
    # paste / encoding round-trips.  Pad to the next multiple of 4 and
    # let b64decode fall back to non-strict mode.
    s = item_data_b64.strip()
    extra = len(s) % 4
    if extra:
        # Try the most-likely-intact prefix (drop the orphan char) first;
        # if that also fails, try padding with `=`.
        candidates = [s[: len(s) - extra], s + ("=" * (4 - extra))]
    else:
        candidates = [s]

    raw = b""
    for cand in candidates:
        try:
            raw = base64.b64decode(cand, validate=False)
            if raw:
                break
        except (ValueError, TypeError) as exc:
            log.debug("cryopod_parser: base64 attempt failed: %s", exc)
            continue
    if not raw:
        return None

    # Cryopods store the dino character payload as a zlib-compressed
    # block inside the item's custom data.  Hunt for the standard zlib
    # magic (0x78 0x9C / 0x78 0xDA / 0x78 0x01) and append the
    # decompressed bytes to the raw data so the FString walker hits
    # both the outer envelope AND the inner dino fields.
    expanded = bytearray(raw)
    # The cryopod custom-data section embeds the dino character payload
    # as a zlib-compressed block.  Find every standard zlib header in
    # the blob and append whatever decompresses to the walker's input
    # so we get hits on both the outer envelope AND the inner fields.
    # We tolerate truncated streams (return whatever zlib gave us
    # before the error) so a 1-byte-short blob still yields most of
    # the readable strings.
    for marker in (b"\x78\x9c", b"\x78\xda", b"\x78\x01"):
        idx = raw.find(marker)
        while idx >= 0:
            try:
                decompressor = zlib.decompressobj()
                decoded = decompressor.decompress(raw[idx:])
                if decoded:
                    expanded.extend(b"\x00\x00\x00\x00")
                    expanded.extend(decoded)
            except zlib.error:
                # Try a partial decode by feeding bytes one chunk at a
                # time -- gives us 'whatever was readable' before the
                # error point, which is usually enough for our string-
                # extraction purposes.
                try:
                    partial = zlib.decompressobj()
                    chunk_size = 4096
                    pos2 = idx
                    accum = bytearray()
                    while pos2 < len(raw):
                        try:
                            accum.extend(partial.decompress(raw[pos2:pos2+chunk_size]))
                            pos2 += chunk_size
                        except zlib.error:
                            break
                    if accum:
                        expanded.extend(b"\x00\x00\x00\x00")
                        expanded.extend(bytes(accum))
                except zlib.error:
                    pass
            idx = raw.find(marker, idx + 2)

    info = CryopodInfo()
    color_buffer: list[str] = []
    color_capture = False

    for s in _walk_fstrings(bytes(expanded)):
        # 1. Dino display name (canonical form 'Name - Lvl X (Species)')
        if info.dino_display_name is None:
            m = _RE_DINO_DISPLAY.match(s)
            if m:
                info.dino_display_name = s
                info.dino_level = int(m.group("lvl"))
                info.dino_species = m.group("species").strip()
                continue

        # 2. Dino class name ('Moschops_Character_BP_C_2147372497')
        if info.dino_class is None:
            m = _RE_DINO_CLASS.match(s)
            if m:
                info.dino_class = s
                if not info.dino_species:
                    info.dino_species = m.group(1)
                continue

        # 3. Stats string ('35,13,24,20,33,8,' -- typically 7 values)
        if info.dino_stats is None and _RE_STATS.match(s):
            info.dino_stats = s
            continue

        # 4. Gender literal
        if info.dino_gender is None and _RE_GENDER.match(s):
            info.dino_gender = s
            continue

        # 5. Full BP path (better source of species than the class id)
        if info.dino_blueprint is None:
            m = _RE_DINO_BP_PATH.match(s)
            if m:
                info.dino_blueprint = s
                if not info.dino_species:
                    info.dino_species = m.group(1)
                continue

        # 6. Color region names: ARK colors all start with the literal
        # 'Dino' or are common color words; the cryopod section
        # typically has 6 of them in a row.  We capture short strings
        # appearing in a contiguous block AFTER we've seen the species.
        if info.dino_species and 3 <= len(s) <= 32 and s.replace(" ", "").isalpha():
            # Reasonable heuristic: collect words that look like colors.
            # Stop collecting once we hit a long non-color string again.
            if (
                s.startswith("Dino ") or
                s in {"Black", "White", "Red", "Green", "Blue", "Yellow",
                      "Orange", "Purple", "Brown", "LightBrown", "DarkBlue",
                      "LightAutumn"} or
                s.endswith("Brown") or s.endswith("Green") or
                s.endswith("Blue")  or s.endswith("Red")   or
                s.endswith("Purple")or s.endswith("Yellow")or
                s.endswith("Orange")
            ):
                color_capture = True
                color_buffer.append(s)
                continue
            elif color_capture:
                # End of the colors run.
                break

    if color_buffer:
        info.dino_colors = color_buffer[:6]   # ARK has 6 color regions

    # Reject empty-info results so callers can early-exit.
    if not (info.dino_display_name or info.dino_class or info.dino_species):
        return None
    return info
