"""
ssh/profile_parser.py — Extract player data from .arkprofile binary files.

Uploads a Python parser script to the remote server and executes it there,
avoiding the need to transfer large binary files back to the management server.

The parser (:mod:`app.ssh.ark_parse_profile`) extracts:
  - ``PlayerCharacterName``: the in-game character display name
  - ``EOS_Id``: the Epic Online Services unique player identifier
"""

import os
import json
import base64
from typing import Dict, List, Optional

from app.ssh.manager import SSHManager

# Local path to the standalone parser scripts
_PARSER_SCRIPT_PATH       = os.path.join(os.path.dirname(__file__), "ark_parse_profile.py")
_TRIBE_PARSER_SCRIPT_PATH = os.path.join(os.path.dirname(__file__), "ark_parse_tribe.py")

# Temporary paths used on the remote server
_REMOTE_PARSER_PATH       = "/tmp/_ark_parse.py"
_REMOTE_TRIBE_PARSER_PATH = "/tmp/_ark_parse_tribe.py"


# ── Parser lifecycle helpers ──────────────────────────────────────────────────

def _upload_parser(ssh: SSHManager) -> None:
    """
    Upload :mod:`app.ssh.ark_parse_profile` to the remote server.

    The script is base64-encoded before transmission to avoid any shell quoting
    issues.  The remote file is written to ``/tmp/_ark_parse.py``.

    Args:
        ssh: Connected :class:`~app.ssh.manager.SSHManager` instance.
    """
    with open(_PARSER_SCRIPT_PATH, "r") as fh:
        content = fh.read()
    encoded = base64.b64encode(content.encode()).decode()
    ssh.execute(f'echo "{encoded}" | base64 -d > {_REMOTE_PARSER_PATH}')


def _cleanup_parser(ssh: SSHManager) -> None:
    """
    Remove the temporary parser script from the remote server.

    Args:
        ssh: Connected :class:`~app.ssh.manager.SSHManager` instance.
    """
    ssh.execute(f"rm -f {_REMOTE_PARSER_PATH}")


# ── Public extraction API ─────────────────────────────────────────────────────

def extract_player_data(ssh: SSHManager, profile_path: str) -> Dict:
    """
    Run the remote parser on a single .arkprofile file and return the result.

    Assumes the parser script has already been uploaded via :func:`_upload_parser`.

    Args:
        ssh:          Connected SSH manager (parser must already be uploaded).
        profile_path: Absolute path of the .arkprofile file on the remote host.

    Returns:
        Dict with keys ``"name"`` (str or None) and ``"eos_id"`` (str or None).
        Returns ``{"name": None, "eos_id": None}`` on any error.
    """
    stdout, _, exit_code = ssh.execute(
        f'python3 {_REMOTE_PARSER_PATH} "{profile_path}" name_only 2>/dev/null'
    )
    if exit_code != 0 or not stdout.strip():
        return {"name": None, "eos_id": None}
    try:
        return json.loads(stdout.strip())
    except (json.JSONDecodeError, ValueError):
        return {"name": None, "eos_id": None}


def scan_and_match_profiles(
    ssh: SSHManager,
    saved_arks_paths: List[str],
) -> List[Dict]:
    """
    Scan one or more SavedArks directories and extract player data from all
    .arkprofile files found.

    Uploads the parser once, processes all profiles in all provided directories,
    then removes the temporary script.  Duplicate file IDs across directories
    are de-duplicated (first occurrence wins).

    Args:
        ssh:               Connected SSH manager.
        saved_arks_paths:  List of absolute SavedArks directory paths to scan.

    Returns:
        List of dicts, each with:
          - ``file_id``     (str): Filename stem (used as the internal ARK player GUID)
          - ``player_name`` (str | None): Extracted character name
          - ``eos_id``      (str | None): Extracted EOS ID
          - ``source_path`` (str): Absolute path of the .arkprofile file
          - ``error``       (str | None): Error description if extraction failed
    """
    _upload_parser(ssh)

    results: List[Dict] = []
    seen_file_ids: set[str] = set()

    try:
        for saved_path in saved_arks_paths:
            stdout, _, exit_code = ssh.execute(
                f'find "{saved_path}" -maxdepth 3 -name "*.arkprofile" -type f 2>/dev/null'
            )
            if exit_code != 0 or not stdout.strip():
                continue

            for prof_path in (p.strip() for p in stdout.strip().splitlines() if p.strip()):
                filename = prof_path.split("/")[-1]
                file_id = filename.replace(".arkprofile", "")

                if file_id in seen_file_ids:
                    continue
                seen_file_ids.add(file_id)

                data = extract_player_data(ssh, prof_path)
                results.append({
                    "file_id": file_id,
                    "player_name": data.get("name"),
                    "eos_id": data.get("eos_id"),
                    "source_path": prof_path,
                    "error": None if data.get("name") else "Name not found.",
                })
    finally:
        _cleanup_parser(ssh)

    return results


# ── Tribe scanning ────────────────────────────────────────────────────────────

def _upload_tribe_parser(ssh: SSHManager) -> None:
    """Upload the .arktribe parser to /tmp/_ark_parse_tribe.py on the remote."""
    with open(_TRIBE_PARSER_SCRIPT_PATH, "r") as fh:
        content = fh.read()
    encoded = base64.b64encode(content.encode()).decode()
    ssh.execute(f'echo "{encoded}" | base64 -d > {_REMOTE_TRIBE_PARSER_PATH}')


def _cleanup_tribe_parser(ssh: SSHManager) -> None:
    ssh.execute(f"rm -f {_REMOTE_TRIBE_PARSER_PATH}")


def extract_tribe_data(ssh: SSHManager, tribe_path: str) -> Dict:
    """
    Run the remote tribe parser on a single .arktribe file and return the result.

    Assumes :func:`_upload_tribe_parser` has already run.

    Returns:
        ``{"name": str | None, "tribe_id": int | None}`` -- on parse error
        both fields are ``None``.
    """
    stdout, _, exit_code = ssh.execute(
        f'python3 {_REMOTE_TRIBE_PARSER_PATH} "{tribe_path}" name_only 2>/dev/null'
    )
    if exit_code != 0 or not stdout.strip():
        return {"name": None, "tribe_id": None}
    try:
        return json.loads(stdout.strip())
    except (json.JSONDecodeError, ValueError):
        return {"name": None, "tribe_id": None}


def scan_and_match_tribes(
    ssh: SSHManager,
    saved_arks_paths: List[str],
) -> List[Dict]:
    """
    Walk SavedArks for ``.arktribe`` files and extract tribe metadata.

    The filename of an .arktribe save IS the in-game ``targeting_team``
    (tribe id), so we use that as the canonical identifier and treat the
    parser-extracted id as a sanity-check fallback.

    Returns:
        List of ``{file_id, tribe_id, tribe_name, source_path, error}``
        with one entry per unique tribe id found.  ``file_id`` and
        ``tribe_id`` are kept separate so the caller can fall back to
        either when matching against the DB.
    """
    _upload_tribe_parser(ssh)

    results: List[Dict] = []
    seen_ids: set[str] = set()

    try:
        for saved_path in saved_arks_paths:
            stdout, _, exit_code = ssh.execute(
                f'find "{saved_path}" -maxdepth 3 -name "*.arktribe" -type f 2>/dev/null'
            )
            if exit_code != 0 or not stdout.strip():
                continue

            for tribe_path in (p.strip() for p in stdout.strip().splitlines() if p.strip()):
                filename = tribe_path.split("/")[-1]
                file_id  = filename.replace(".arktribe", "")
                if file_id in seen_ids:
                    continue
                seen_ids.add(file_id)

                # The filename is the targeting_team -- coerce when possible.
                try:
                    fid_int: Optional[int] = int(file_id)
                except ValueError:
                    fid_int = None

                data = extract_tribe_data(ssh, tribe_path)
                results.append({
                    "file_id":     file_id,
                    "tribe_id":    fid_int if fid_int is not None else data.get("tribe_id"),
                    "tribe_name":  data.get("name"),
                    "source_path": tribe_path,
                    "error":       None if data.get("name") else "Tribe name not found.",
                })
    finally:
        _cleanup_tribe_parser(ssh)

    return results
