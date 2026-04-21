"""
ssh/player_transfer.py — Player profile search and cross-map character copying.

Provides two main capabilities:
  1. Searching all scanned containers on a machine to find which maps contain
     a specific player's .arkprofile binary file.
  2. Copying a .arkprofile file from a source map/machine to a destination
     map/machine, optionally backing up the existing file first.

Both operations work over SSH and support cross-machine transfers where the
source and destination servers are different physical hosts.
"""

import base64
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from app.ssh.manager import SSHManager
from app.ssh.profile_parser import _upload_parser, _cleanup_parser, extract_player_data

logger = logging.getLogger(__name__)


# ── Player map discovery ───────────────────────────────────────────────────────

def find_player_maps_on_machine(
    ssh: SSHManager,
    eos_id: str,
    machine_id: int,
    machine_name: str,
    hostname: str,
    containers: List[Dict],
    debug: bool = False,
) -> Tuple[List[Dict], List[Dict]]:
    """
    Search all containers on a machine for a player's .arkprofile file.

    The function looks for ``{eos_id}.arkprofile`` in every map subdirectory
    of every container that has a known ``saved_arks`` path.  The profile
    parser script is uploaded at most once per call (lazy, on first hit).

    Args:
        ssh:          Connected :class:`~app.ssh.manager.SSHManager` for the machine.
        eos_id:       The player's EOS_Id (used as the profile filename stem).
        machine_id:   Machine primary key (included in results for UI routing).
        machine_name: Human-readable machine name.
        hostname:     Hostname / IP of the machine.
        containers:   List of container dicts as produced by the container scanner.
        debug:        When True, detailed per-path diagnostic entries are included
                      in the returned debug list.

    Returns:
        A two-element tuple:
          - List of result dicts (one per located profile), each with keys:
            ``machine_id``, ``machine_name``, ``hostname``, ``container_name``,
            ``map_name``, ``map_path``, ``profile_path``, ``file_id``,
            ``player_name``.
          - List of debug dicts (empty when *debug* is False).
    """
    results: List[Dict] = []
    debug_info: List[Dict] = []
    target_filename = f"{eos_id}.arkprofile"
    parser_uploaded = False

    try:
        for container in containers:
            saved_arks = container.get("paths", {}).get("saved_arks")
            if not saved_arks:
                if debug:
                    debug_info.append({
                        "container": container["name"],
                        "step": "skip",
                        "reason": "no saved_arks path",
                    })
                continue

            container_name = container["name"]
            map_dirs = container.get("map_dirs", [])

            # Build the list of directories to check.
            # Named map subdirectories are checked individually; the SavedArks
            # root is also checked as a fallback for single-map servers where
            # profiles are stored directly at the root level.
            search_dirs: List[Dict] = [
                {"name": md["name"], "path": md["path"], "is_root": False}
                for md in map_dirs
            ]
            search_dirs.append({
                "name": container.get("map_name") or container_name,
                "path": saved_arks,
                "is_root": True,
            })

            if debug:
                debug_info.append({
                    "container": container_name,
                    "saved_arks": saved_arks,
                    "map_dirs": [md["name"] for md in map_dirs],
                    "target_file": target_filename,
                })

            for search_dir in search_dirs:
                dir_path = search_dir["path"]
                is_root = search_dir["is_root"]

                # When checking the root and named map dirs exist, look only
                # at the root level (not recursively into subdirs already covered)
                if is_root and map_dirs:
                    candidate = f"{saved_arks}/{target_filename}"
                else:
                    candidate = f"{dir_path}/{target_filename}"

                stdout, _, _ = ssh.execute(
                    f'test -f "{candidate}" && echo "FOUND" 2>/dev/null'
                )
                found = stdout.strip() == "FOUND"

                if debug:
                    debug_info.append({
                        "container": container_name,
                        "dir_name": search_dir["name"],
                        "checked_path": candidate,
                        "found": found,
                    })

                if not found:
                    continue

                # Upload the binary parser on first hit (amortised cost)
                if not parser_uploaded:
                    _upload_parser(ssh)
                    parser_uploaded = True

                player_data = extract_player_data(ssh, candidate)
                results.append({
                    "machine_id": machine_id,
                    "machine_name": machine_name,
                    "hostname": hostname,
                    "container_name": container_name,
                    "map_name": search_dir["name"],
                    "map_path": dir_path,
                    "profile_path": candidate,
                    "file_id": eos_id,
                    "player_name": player_data.get("name"),
                })

    finally:
        if parser_uploaded:
            _cleanup_parser(ssh)

    return results, debug_info


# ── Profile download / upload ─────────────────────────────────────────────────

def download_profile_data(
    ssh: SSHManager,
    profile_path: str,
) -> Tuple[str, bytes]:
    """
    Download a .arkprofile binary file from a remote server as raw bytes.

    The file is transferred via ``base64`` encoding to avoid binary corruption
    in the SSH stream.

    Args:
        ssh:          Connected SSH manager for the source machine.
        profile_path: Absolute path of the .arkprofile file on the remote host.

    Returns:
        A ``(filename, raw_bytes)`` tuple.

    Raises:
        FileNotFoundError: The remote file does not exist.
        ValueError:        The file is empty or exceeds the 10 MB safety limit.
        IOError:           The base64 download command failed.
    """
    filename = profile_path.split("/")[-1]

    # Verify existence and retrieve file size in a single command
    stdout, _, exit_code = ssh.execute(
        f'test -f "{profile_path}" && stat -c %s "{profile_path}" 2>/dev/null'
    )
    if exit_code != 0 or not stdout.strip():
        raise FileNotFoundError(f"Profile not found: {profile_path}")

    file_size = int(stdout.strip())

    if file_size == 0:
        raise ValueError(f"Profile file is empty: {profile_path}")
    if file_size > 10 * 1024 * 1024:
        raise ValueError(
            f"Profile file too large ({file_size} bytes); safety limit is 10 MB."
        )

    # Transfer as base64 to preserve binary integrity over the SSH stream
    stdout, stderr, exit_code = ssh.execute(f'base64 "{profile_path}" 2>/dev/null')
    if exit_code != 0 or not stdout.strip():
        raise IOError(f"Download failed: exit_code={exit_code}, stderr={stderr[:200]}")

    raw_bytes = base64.b64decode(stdout.strip())

    if len(raw_bytes) != file_size:
        logger.warning(
            "Size mismatch for '%s': expected %d bytes, received %d bytes.",
            profile_path, file_size, len(raw_bytes),
        )

    return filename, raw_bytes


def upload_profile_data(
    ssh: SSHManager,
    dest_dir: str,
    filename: str,
    raw_bytes: bytes,
    backup: bool = True,
) -> Dict:
    """
    Upload a .arkprofile binary file to a remote directory.

    The upload writes to a temporary path first, then atomically renames to the
    final destination to minimise the risk of a partially-written file.  A
    timestamped backup of any existing file is created when *backup* is True.

    Args:
        ssh:       Connected SSH manager for the destination machine.
        dest_dir:  Absolute path of the destination directory on the remote host.
        filename:  Target filename (e.g. ``<eos_id>.arkprofile``).
        raw_bytes: Raw binary content to upload.
        backup:    Whether to create a ``.bak.<timestamp>`` backup beforehand.

    Returns:
        Dict with keys: ``dest_path``, ``backup_path``, ``overwritten``, ``size``.

    Raises:
        FileNotFoundError: The destination directory does not exist.
        IOError:           The temporary write or rename command failed.
    """
    dest_path = f"{dest_dir}/{filename}"
    operation_result = {
        "dest_path": dest_path,
        "backup_path": None,
        "overwritten": False,
        "size": len(raw_bytes),
    }

    # Verify the destination directory exists
    stdout, _, _ = ssh.execute(f'test -d "{dest_dir}" && echo "ok" 2>/dev/null')
    if stdout.strip() != "ok":
        raise FileNotFoundError(f"Destination directory not found: {dest_dir}")

    # Create backup if the destination file already exists
    stdout, _, _ = ssh.execute(f'test -f "{dest_path}" && echo "exists" 2>/dev/null')
    if stdout.strip() == "exists":
        operation_result["overwritten"] = True
        if backup:
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            backup_path = f"{dest_path}.bak.{timestamp}"
            _, _, bcode = ssh.execute(f'cp "{dest_path}" "{backup_path}" 2>/dev/null')
            if bcode == 0:
                operation_result["backup_path"] = backup_path
            else:
                logger.warning("Backup creation failed for '%s'.", dest_path)

    # Write to a temporary file, then atomically move to the final destination
    encoded = base64.b64encode(raw_bytes).decode("ascii")
    tmp_path = f"/tmp/_profile_upload_{filename}"

    _, _, write_code = ssh.execute(
        f'echo "{encoded}" | base64 -d > "{tmp_path}" 2>/dev/null'
    )
    if write_code != 0:
        raise IOError(f"Failed to write temporary file: {tmp_path}")

    _, stderr, move_code = ssh.execute(f'mv "{tmp_path}" "{dest_path}" 2>/dev/null')
    if move_code != 0:
        ssh.execute(f'rm -f "{tmp_path}" 2>/dev/null')  # best-effort cleanup
        raise IOError(f"Failed to move profile to destination: {stderr[:200]}")

    # Post-upload size verification
    stdout, _, _ = ssh.execute(f'stat -c %s "{dest_path}" 2>/dev/null')
    if stdout.strip():
        actual_size = int(stdout.strip())
        if actual_size != len(raw_bytes):
            logger.warning(
                "Post-upload size mismatch for '%s': expected %d, got %d bytes.",
                dest_path, len(raw_bytes), actual_size,
            )

    return operation_result


def copy_player_profile(
    source_ssh: SSHManager,
    dest_ssh: SSHManager,
    source_profile_path: str,
    dest_map_dir: str,
    backup: bool = True,
) -> Dict:
    """
    Copy a .arkprofile file from a source map to a destination map.

    Supports both same-machine and cross-machine transfers.  When the source
    and destination are on different hosts, the file bytes are downloaded from
    the source into memory and then uploaded to the destination.

    Args:
        source_ssh:          Connected SSH manager for the source host.
        dest_ssh:            Connected SSH manager for the destination host.
        source_profile_path: Absolute path of the source .arkprofile file.
        dest_map_dir:        Destination map directory (e.g. ``.../SavedArks/Aberration_WP``).
        backup:              Whether to back up the destination file if it exists.

    Returns:
        Dict with ``success``, ``source_path``, ``filename``, and upload result fields.

    Raises:
        FileNotFoundError, ValueError, IOError: Propagated from the download/upload helpers.
    """
    filename, raw_bytes = download_profile_data(source_ssh, source_profile_path)
    upload_info = upload_profile_data(dest_ssh, dest_map_dir, filename, raw_bytes, backup=backup)
    return {
        "success": True,
        "source_path": source_profile_path,
        "filename": filename,
        **upload_info,
    }


# ── Container / map resolution helpers ───────────────────────────────────────

def resolve_map_directory(
    ssh: SSHManager,
    container: Dict,
    map_name: str,
) -> Optional[str]:
    """
    Resolve the absolute path of a named map directory within a container.

    Search order:
      1. Scan the container's known ``map_dirs`` list for an exact name match.
      2. Check whether the container's primary ``map_name`` matches (return SavedArks root).
      3. Construct ``{saved_arks}/{map_name}`` and verify its existence via SSH.

    Args:
        ssh:        Connected SSH manager for the machine hosting the container.
        container:  Container dict as produced by the container scanner.
        map_name:   Map directory name to resolve (e.g. ``Aberration_WP``).

    Returns:
        Absolute path string, or ``None`` if the directory cannot be found.
    """
    # Check pre-scanned map directory list
    for md in container.get("map_dirs", []):
        if md["name"].lower() == map_name.lower():
            return md["path"]

    saved_arks = container.get("paths", {}).get("saved_arks")
    if not saved_arks:
        return None

    # If the container has only one map, its root may be the right path
    container_map = container.get("map_name", "")
    if container_map and container_map.lower() == map_name.lower():
        return saved_arks

    # Try constructing the path and verifying on the remote host
    candidate = f"{saved_arks}/{map_name}"
    stdout, _, _ = ssh.execute(f'test -d "{candidate}" && echo "ok" 2>/dev/null')
    return candidate if stdout.strip() == "ok" else None


def find_container_in_map(
    containers_map: Dict,
    machine_id: int,
    container_name: str,
) -> Tuple[Optional[Dict], Optional[Dict]]:
    """
    Look up a container entry in the persisted containers map.

    Args:
        containers_map: Full containers map dict.
        machine_id:     Machine primary key.
        container_name: Container directory name to find.

    Returns:
        ``(machine_data, container_data)`` tuple.  Both elements are ``None``
        if the machine or container is not found.
    """
    machine_data = containers_map.get("machines", {}).get(str(machine_id))
    if not machine_data:
        return None, None

    container = next(
        (c for c in machine_data.get("containers", []) if c["name"] == container_name),
        None,
    )
    return machine_data, container
