#!/usr/bin/env python3
"""
ark_parse_tribe.py -- Parser for ARK: Survival Ascended .arktribe binary files.

Sibling of ark_parse_profile.py: same UE4 FString-extraction approach, but
targets the TribeName field of `.arktribe` save files.  The tribe id is
NOT extracted from the binary because the file is already named after it
(`<targeting_team>.arktribe`) -- the caller passes the filename id in
separately.

Usage:
    python3 ark_parse_tribe.py <path_to_arktribe> [name_only|debug]

Exit codes:
    0 -- success (output always written to stdout as JSON)
    1 -- argument error or file I/O failure
"""

import sys
import struct
import json
import re
from typing import Optional


# ── Shared FString constants ─────────────────────────────────────────────────

_FSTRING_MIN_LEN: int = 3
_FSTRING_MAX_LEN: int = 512
_NAME_SEARCH_WINDOW: int = 200

# Markers that precede the tribe display name in the save stream.
# `TribeName` is the canonical field; some early ASA exports use `Name`.
_TRIBE_NAME_MARKERS: tuple[bytes, ...] = (
    b"TribeName",
    b"Name",
)

# Markers that precede the in-game tribe id (TargetingTeam / TribeID).
# Used as a sanity check / fallback when the filename id is missing.
_TRIBE_ID_MARKERS: tuple[bytes, ...] = (
    b"TribeID",
    b"TargetingTeam",
)

# Lowercase fragments that disqualify a decoded string as a tribe name.
# Mostly the same engine/blueprint keywords we filter for player names,
# but WITHOUT "tribe" (a real tribe name often starts with "The Tribe
# of...") and WITHOUT "name" (the marker text appears as a literal
# string near the value).
_TECHNICAL_FRAGMENTS: tuple[str, ...] = (
    "property", "script/", "game/", "/script", "blueprint",
    "primal", "shooter", "struct", "object", "class",
    "component", "character_bp", "buff", "persistent",
    "testgamemode", "level", "island", "map", "submap",
    "saved", "config", "engine", "none", "default",
    "status", "inventory", "array", "bool",
    "float", "int", "byte", "str", "text",
    "enum", "soft", "guid", "vector", "rotator",
    "transform", "linear", "color",
    # tribe-file specific noise:
    "tribelog", "ownerplayerdataid", "tribeadminid",
    "membersplayerdataid", "membersplayername",
    "membersplayerid",
)


# ── FString extraction (identical to ark_parse_profile) ──────────────────────

def extract_fstrings(
    data: bytes,
    min_length: int = _FSTRING_MIN_LEN,
) -> list[tuple[int, str]]:
    """Linearly scan binary data and return all (offset, decoded) FStrings."""
    strings: list[tuple[int, str]] = []
    pos: int = 0
    data_len: int = len(data)

    while pos < data_len - 8:
        (length,) = struct.unpack_from("<i", data, pos)

        if _FSTRING_MIN_LEN < length < _FSTRING_MAX_LEN:
            end = pos + 4 + length
            if end <= data_len:
                raw = data[pos + 4:end]
                if raw[-1:] == b"\x00":
                    try:
                        decoded = raw[:-1].decode("utf-8", errors="ignore")
                        if len(decoded) >= min_length and decoded.isprintable():
                            strings.append((pos, decoded))
                            pos = end
                            continue
                    except UnicodeDecodeError:
                        pass

        elif -_FSTRING_MAX_LEN < length < -_FSTRING_MIN_LEN:
            byte_count = (-length) * 2
            end = pos + 4 + byte_count
            if end <= data_len:
                raw = data[pos + 4:end]
                try:
                    decoded = raw.decode("utf-16-le", errors="ignore").rstrip("\x00")
                    if len(decoded) >= min_length and decoded.isprintable():
                        strings.append((pos, decoded))
                        pos = end
                        continue
                except UnicodeDecodeError:
                    pass

        pos += 1

    return strings


# ── Classifier ───────────────────────────────────────────────────────────────

def _is_technical_string(value: str) -> bool:
    """True if *value* looks like an engine identifier rather than a tribe name."""
    lower = value.lower()
    if any(fragment in lower for fragment in _TECHNICAL_FRAGMENTS):
        return True
    if "/" in value or "\\" in value:
        return True
    if value.startswith("_") or value.endswith("_C"):
        return True
    if re.match(r"^[0-9a-f]{16,}$", value, re.IGNORECASE):
        return True
    if value.replace(".", "").replace("-", "").replace("_", "").isdigit():
        return True
    return False


# ── Field finders ────────────────────────────────────────────────────────────

def find_tribe_name(
    data: bytes,
    fstrings: list[tuple[int, str]],
) -> Optional[str]:
    """
    Locate the tribe display name in the binary save data.

    Same windowed-marker strategy as the player-name finder: for every
    known TribeName marker position, return the first non-technical
    FString within the next _NAME_SEARCH_WINDOW bytes.  Falls back to
    scanning for a literal "TribeName" FString and returning its
    immediate neighbours.
    """
    for marker in _TRIBE_NAME_MARKERS:
        search_start = 0
        while True:
            marker_pos = data.find(marker, search_start)
            if marker_pos < 0:
                break
            field_end = marker_pos + len(marker)
            for offset, value in fstrings:
                if field_end < offset < field_end + _NAME_SEARCH_WINDOW:
                    if not _is_technical_string(value):
                        return value
            search_start = marker_pos + 1

    # Fallback: scan for FStrings whose text IS the field name and take
    # the first non-technical neighbour after them.
    for idx, (_, key) in enumerate(fstrings):
        if "TribeName" in key:
            for j in range(idx + 1, min(idx + 10, len(fstrings))):
                candidate = fstrings[j][1]
                if not _is_technical_string(candidate):
                    return candidate

    return None


def find_tribe_id(data: bytes) -> Optional[int]:
    """
    Best-effort extraction of the in-binary tribe id (TargetingTeam).

    Scans for the int32 immediately following each known marker and
    returns the first plausible non-zero value.  When the tribe id
    is unrecoverable from the binary the caller is expected to fall
    back to the filename, which IS the targeting_team in canonical
    ARK saves.
    """
    for marker in _TRIBE_ID_MARKERS:
        search_start = 0
        while True:
            marker_pos = data.find(marker, search_start)
            if marker_pos < 0:
                break
            field_end = marker_pos + len(marker)
            # The int32 value sits a handful of bytes after the marker
            # (UE4 property tag + 8 bytes of size/index metadata).  Try
            # every offset in a small window and accept the first
            # non-trivial value.
            for delta in range(8, 64, 4):
                if field_end + delta + 4 <= len(data):
                    (val,) = struct.unpack_from("<i", data, field_end + delta)
                    if 1 <= val < 0x7fffffff:
                        return val
            search_start = marker_pos + 1
    return None


# ── CLI entry point ──────────────────────────────────────────────────────────

def main() -> None:
    """Parse CLI args, read the .arktribe file, print JSON to stdout."""
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: ark_parse_tribe.py <path> [name_only|debug]"}))
        sys.exit(1)

    tribe_path: str = sys.argv[1]
    mode: str = sys.argv[2] if len(sys.argv) > 2 else "debug"

    try:
        with open(tribe_path, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        print(json.dumps({"error": f"Cannot read file '{tribe_path}': {exc}"}))
        sys.exit(1)

    fstrings = extract_fstrings(data)
    tribe_name = find_tribe_name(data, fstrings)
    tribe_id   = find_tribe_id(data)

    if mode == "name_only":
        print(json.dumps({"name": tribe_name, "tribe_id": tribe_id}))
    else:
        output = {
            "size":           len(data),
            "hex_header":     data[:32].hex(),
            "total_fstrings": len(fstrings),
            "extracted_name": tribe_name,
            "extracted_id":   tribe_id,
            "fstrings_all":   [s for _, s in fstrings],
        }
        marker_pos = data.find(b"TribeName")
        if marker_pos >= 0:
            output["tribename_at"] = marker_pos
            output["tribename_nearby"] = [
                s for o, s in fstrings if marker_pos - 50 < o < marker_pos + 300
            ]
        print(json.dumps(output))


if __name__ == "__main__":
    main()
