#!/usr/bin/env python3
"""
ark_parse_profile.py — Parser for ARK: Survival Ascended .arkprofile binary files.

This script is uploaded to remote servers via base64-encoding and executed remotely
to extract player data from UE4/UE5 binary save files without requiring native file
transfer of the whole binary to the management server.

Extracted fields:
    - PlayerCharacterName: the in-game character display name
    - EOS_Id: the Epic Online Services unique player identifier

Binary format notes:
    .arkprofile files use UE4 FString encoding:
      - Positive length N  → N bytes of UTF-8 data (null-terminated)
      - Negative length -N → N×2 bytes of UTF-16-LE data (null-terminated)
    Fields are located by scanning for binary markers (property name tags)
    that immediately precede the value in the serialised save stream.

Usage:
    python3 ark_parse_profile.py <path_to_arkprofile> [name_only|debug]

Exit codes:
    0 — success (output always written to stdout as JSON)
    1 — argument error or file I/O failure
"""

import sys
import struct
import json
import re
from typing import Optional

# ── String extraction constants ───────────────────────────────────────────────

# Valid length range for UE4 FStrings (in characters, not bytes)
_FSTRING_MIN_LEN: int = 3
_FSTRING_MAX_LEN: int = 512

# Maximum byte offset from a field marker to search for the associated value
_NAME_SEARCH_WINDOW: int = 200
_ID_SEARCH_WINDOW: int = 400

# Binary markers that precede the player's character name in the save stream
_PLAYER_NAME_MARKERS: tuple[bytes, ...] = (
    b"PlayerCharacterName",
    b"PlayerName",
)

# Binary markers that precede EOS / platform ID values in the save stream
_EOS_ID_MARKERS: tuple[bytes, ...] = (
    b"UniqueNetIdRepl",
    b"PlatformProfileName",
    b"LinkedPlayerIds",
    b"UniqueNetId",
    b"EOS_Id",
    b"PlatformUserId",
    b"EOS",
    b"PlayerDataID",
    b"SavedNetworkAddress",
)

# Strong-evidence technical fragments.  Any decoded string CONTAINING one of
# these (case-insensitive) is rejected as an engine identifier.  This list
# ONLY includes patterns that are vanishingly unlikely to appear in a real
# player display name (URL-style separators, blueprint suffixes, namespace
# qualifiers).  The previous version blacklisted entire common English words
# (e.g. "name", "map", "level", "str", "bool", "int", "float", "primal") and
# rejected legitimate names like "Mapmaker", "Levellord", "Aristocrat" as
# false positives -- that's what caused the 'sync-names skips some players'
# bug reported by the operator.
_TECHNICAL_FRAGMENTS: tuple[str, ...] = (
    "/script/", "/game/", "blueprintgenerated",
    "default__", "::",
    "primalcharacter", "shootercharacter", "playercharacter_",
    "character_bp_", "_buff_c", "structurebp_",
)

# Exact-match (case-insensitive) reserved words.  A decoded string that
# IS exactly one of these gets rejected.  Substring containment is no longer
# enough -- this catches the bare property type tokens UE serialises
# alongside player data without mistaking real-world player names that
# happen to contain the same letters.
_TECHNICAL_EXACT: frozenset[str] = frozenset(
    s.lower() for s in (
        "None", "Default", "True", "False",
        "BoolProperty", "ByteProperty", "IntProperty", "FloatProperty",
        "DoubleProperty", "StrProperty", "TextProperty", "NameProperty",
        "ObjectProperty", "ArrayProperty", "MapProperty", "SetProperty",
        "StructProperty", "EnumProperty", "SoftObjectProperty",
        "Guid", "Vector", "Rotator", "Transform", "Color",
        "PrimalCharacterStatusComponent", "PrimalInventoryComponent",
        "PersistentLevel", "TheIsland", "TheCenter", "Ragnarok",
        "Aberration_P", "Extinction", "ScorchedEarth_P", "Genesis",
        "Genesis_Part_2", "CrystalIsles", "Valguero_P", "LostIsland",
        "Fjordur", "BobsMissions", "Astraeos",
    )
)

# Regex patterns that match known EOS / platform player ID formats
_EOS_ID_PATTERNS: tuple[str, ...] = (
    r"^[0-9a-f]{32}$",                                                         # 32-char hex (EOS standard)
    r"^[0-9a-f]{16}$",                                                         # 16-char hex (Steam-style)
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",        # RFC 4122 UUID
    r"^\d{15,20}$",                                                             # Long numeric Steam ID
)


# ── FString extraction ────────────────────────────────────────────────────────

def extract_fstrings(
    data: bytes,
    min_length: int = _FSTRING_MIN_LEN,
) -> list[tuple[int, str]]:
    """
    Linearly scan binary data and extract all valid UE4 FString values.

    The scanner advances one byte at a time when the current position does not
    yield a valid string, and jumps over confirmed strings to avoid redundant
    re-parsing.

    Args:
        data:       Raw bytes of a .arkprofile binary save file.
        min_length: Minimum decoded character count required to keep a string.

    Returns:
        A list of ``(byte_offset, decoded_string)`` tuples in file order.
        The byte_offset is the position of the 4-byte length prefix in *data*.
    """
    strings: list[tuple[int, str]] = []
    pos: int = 0
    data_len: int = len(data)

    while pos < data_len - 8:
        # Read the 4-byte signed little-endian length prefix
        (length,) = struct.unpack_from("<i", data, pos)

        # ── UTF-8 encoded FString (positive length) ───────────────────────
        if _FSTRING_MIN_LEN < length < _FSTRING_MAX_LEN:
            end = pos + 4 + length
            if end <= data_len:
                raw = data[pos + 4:end]
                # UE4 always null-terminates FStrings
                if raw[-1:] == b"\x00":
                    try:
                        decoded = raw[:-1].decode("utf-8", errors="ignore")
                        if len(decoded) >= min_length and _is_human_readable(decoded):
                            strings.append((pos, decoded))
                            pos = end
                            continue
                    except UnicodeDecodeError:
                        pass

        # ── UTF-16-LE encoded FString (negative length) ───────────────────
        elif -_FSTRING_MAX_LEN < length < -_FSTRING_MIN_LEN:
            byte_count = (-length) * 2
            end = pos + 4 + byte_count
            if end <= data_len:
                raw = data[pos + 4:end]
                try:
                    decoded = raw.decode("utf-16-le", errors="ignore").rstrip("\x00")
                    if len(decoded) >= min_length and _is_human_readable(decoded):
                        strings.append((pos, decoded))
                        pos = end
                        continue
                except UnicodeDecodeError:
                    pass

        pos += 1

    return strings


# ── Classifier helpers ────────────────────────────────────────────────────────

def _is_human_readable(value: str) -> bool:
    """
    Permissive printable-text check used in place of bare ``str.isprintable()``.

    Python's ``str.isprintable()`` rejects whitespace categories that are
    perfectly legitimate inside player nicknames -- notably the non-breaking
    space (``\\xa0``), the ideographic space (``\\u3000``), and tabs.  Many
    ARK players use stylised names with those characters; the previous
    parser silently dropped them.

    A name passes this check when:
      * it contains at least one alphanumeric character (defends against
        files where the only candidate string is a separator run);
      * every char is either Python-printable OR one of the well-known
        non-printable whitespace categories used in display names.
    """
    if not any(c.isalnum() for c in value):
        return False
    extra_allowed = (" ", "\t", " ", "　", " ", " ")
    return all(c.isprintable() or c in extra_allowed for c in value)


def _is_technical_string(value: str) -> bool:
    """
    Return True if *value* looks like an engine/blueprint identifier rather
    than a human-readable player name.

    Heuristics applied (in order):
      1. The string is exactly one of the reserved-word tokens UE serialises
         alongside data (case-insensitive exact match).
      2. The string contains a strong-evidence technical fragment
         (``/script/``, ``blueprintgenerated``, ``default__``, ``::``, ...).
      3. The string contains a filesystem or asset-path separator
         (``/`` or ``\\``).
      4. The string starts with ``_`` or ends with ``_C`` (Blueprint class
         naming convention).
      5. The string is a long pure-hex blob (raw binary ID, not a name).
      6. The string is numeric after stripping common punctuation.

    Notes for maintainers: this filter used to use a much wider blacklist
    of common English words (``name``, ``map``, ``level``, ``str``,
    ``bool``, ``int``, ``float``, ``primal``, ...).  That false-positived
    legitimate player names like ``Mapmaker``, ``Levellord`` and
    ``Aristocrat``, which is what caused the 'sync-names skips some
    players' bug.  Keep additions surgical -- prefer adding to
    ``_TECHNICAL_EXACT`` over adding a substring fragment.
    """
    if value.lower() in _TECHNICAL_EXACT:
        return True
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


def _looks_like_eos_id(value: str) -> bool:
    """
    Return True if *value* matches a recognised EOS or platform player ID format.

    Supported patterns: 32-char hex, 16-char hex, RFC 4122 UUID, long numeric ID.

    Args:
        value: Candidate decoded string.

    Returns:
        True when the string conforms to a known ID pattern.
    """
    stripped = value.strip()
    return any(re.match(pattern, stripped, re.IGNORECASE) for pattern in _EOS_ID_PATTERNS)


# ── Field-specific finders ────────────────────────────────────────────────────

def find_player_name(
    data: bytes,
    fstrings: list[tuple[int, str]],
) -> Optional[str]:
    """
    Locate the player's character name in the binary save data.

    Search strategy:
      1. For each known name-marker, find its byte position in *data*.
      2. Collect all FStrings whose offset falls within ``_NAME_SEARCH_WINDOW``
         bytes after the marker end.
      3. Return the first non-technical string found.
      4. Fallback: scan all FStrings for those whose text *contains*
         "PlayerCharacterName" or "CharacterName" and return the next
         non-technical neighbour string.

    Args:
        data:     Raw bytes of the .arkprofile file.
        fstrings: Pre-extracted ``(offset, string)`` pairs.

    Returns:
        The player character name, or ``None`` if not found.
    """
    for marker in _PLAYER_NAME_MARKERS:
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

    # Fallback: look for FStrings that themselves contain the field name
    for idx, (_, key) in enumerate(fstrings):
        if "PlayerCharacterName" in key or "CharacterName" in key:
            for j in range(idx + 1, min(idx + 10, len(fstrings))):
                candidate = fstrings[j][1]
                if not _is_technical_string(candidate):
                    return candidate

    return None


def find_eos_id(
    data: bytes,
    fstrings: list[tuple[int, str]],
) -> Optional[str]:
    """
    Locate the player's EOS (Epic Online Services) unique identifier.

    Search strategy:
      1. For each known ID-marker, find its byte position in *data*.
      2. Collect all FStrings whose offset falls within ``_ID_SEARCH_WINDOW``
         bytes after the marker end.
      3. Return the first string that matches a known ID pattern.
      4. Fallback: scan all FStrings and return the first ID-shaped value.

    Args:
        data:     Raw bytes of the .arkprofile file.
        fstrings: Pre-extracted ``(offset, string)`` pairs.

    Returns:
        The EOS ID string, or ``None`` if not found.
    """
    for marker in _EOS_ID_MARKERS:
        search_start = 0
        while True:
            marker_pos = data.find(marker, search_start)
            if marker_pos < 0:
                break
            field_end = marker_pos + len(marker)
            for offset, value in fstrings:
                if field_end < offset < field_end + _ID_SEARCH_WINDOW:
                    if _looks_like_eos_id(value):
                        return value
            search_start = marker_pos + 1

    # Fallback: return the first ID-shaped string anywhere in the file
    for _, value in fstrings:
        if _looks_like_eos_id(value):
            return value

    return None


# ── Output builders ───────────────────────────────────────────────────────────

def _build_debug_output(
    data: bytes,
    fstrings: list[tuple[int, str]],
    player_name: Optional[str],
    eos_id: Optional[str],
) -> dict:
    """
    Build a comprehensive diagnostic dictionary for *debug* mode output.

    Includes raw hex header, all extracted strings, all ID candidates,
    and the precise byte offset of the PlayerCharacterName marker.

    Args:
        data:        Raw file bytes.
        fstrings:    All extracted ``(offset, string)`` pairs.
        player_name: Resolved player name, or ``None``.
        eos_id:      Resolved EOS ID, or ``None``.

    Returns:
        A dictionary ready for ``json.dumps``.
    """
    output: dict = {
        "size": len(data),
        "hex_header": data[:32].hex(),
        "total_fstrings": len(fstrings),
        "extracted_name": player_name,
        "extracted_eos_id": eos_id,
        "all_id_candidates": [s for _, s in fstrings if _looks_like_eos_id(s)],
        "fstrings_all": [s for _, s in fstrings],
    }

    # Annotate the PlayerCharacterName marker location when present
    pcn_pos = data.find(b"PlayerCharacterName")
    if pcn_pos >= 0:
        output["pcn_found_at"] = pcn_pos
        nearby_strings = [s for o, s in fstrings if pcn_pos - 50 < o < pcn_pos + 300]
        output["pcn_nearby"] = nearby_strings

    return output


# ── CLI entry point ───────────────────────────────────────────────────────────

def main() -> None:
    """
    Parse CLI arguments, read the .arkprofile file, and print JSON to stdout.

    Modes:
        name_only — minimal output: ``{"name": "...", "eos_id": "..."}``
        debug     — full diagnostic output (default)
    """
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: ark_parse_profile.py <path> [name_only|debug]"}))
        sys.exit(1)

    profile_path: str = sys.argv[1]
    mode: str = sys.argv[2] if len(sys.argv) > 2 else "debug"

    try:
        with open(profile_path, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        print(json.dumps({"error": f"Cannot read file '{profile_path}': {exc}"}))
        sys.exit(1)

    fstrings = extract_fstrings(data)
    player_name = find_player_name(data, fstrings)
    eos_id = find_eos_id(data, fstrings)

    if mode == "name_only":
        print(json.dumps({"name": player_name, "eos_id": eos_id}))
    else:
        output = _build_debug_output(data, fstrings, player_name, eos_id)
        print(json.dumps(output))


if __name__ == "__main__":
    main()
