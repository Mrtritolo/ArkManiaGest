"""
api/routes/containers.py — Container discovery and plugin config management.

Provides endpoints to scan game server containers via SSH, read/write plugin
configuration files, and browse the container filesystem.  Container metadata
is persisted to the application database (via plugin config key "containers_map")
so subsequent requests do not require a live SSH connection.
"""

import json
import posixpath
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import server_settings
from app.core.store import get_machine_sync, get_plugin_config_sync, save_plugin_config_sync
from app.ssh.manager import SSHManager
from app.ssh.scanner import (
    scan_containers, scan_single_container,
    read_remote_file, write_remote_file, backup_remote_file,
    CONTAINER_BASE,
)

router = APIRouter()

# Settings key used to persist the container map in the application database
_CONTAINERS_MAP_KEY = "containers_map"


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_machine_or_404(machine_id: int) -> dict:
    """
    Retrieve a machine record by ID or raise HTTP 404.

    Args:
        machine_id: Primary key of the SSH machine.

    Returns:
        Machine dict with decrypted credentials.

    Raises:
        HTTPException: 404 if the machine does not exist.
    """
    machine = get_machine_sync(machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found.")
    return machine


def _ssh_for_machine(machine: dict) -> SSHManager:
    """
    Construct an :class:`~app.ssh.manager.SSHManager` from a machine dict.

    The SSH timeout is sourced from :attr:`server_settings.SSH_TIMEOUT` so
    that a single .env change propagates everywhere.

    Args:
        machine: Decrypted machine dict (as returned by the store layer).

    Returns:
        Configured but not yet connected SSHManager instance.
    """
    return SSHManager(
        host=machine["hostname"],
        username=machine["ssh_user"],
        password=machine.get("ssh_password"),
        key_path=machine.get("ssh_key_path"),
        port=machine.get("ssh_port", 22),
        timeout=server_settings.SSH_TIMEOUT,
    )


def _load_containers_map() -> dict:
    """
    Load the persisted container map from the application database.

    Returns:
        Dict with ``machines`` (keyed by machine_id string) and
        ``last_scan`` timestamp.  Returns an empty structure when not found.
    """
    return get_plugin_config_sync(_CONTAINERS_MAP_KEY) or {"machines": {}, "last_scan": None}


def _save_containers_map(data: dict) -> None:
    """
    Persist the container map to the application database.

    Args:
        data: Updated container map dict.
    """
    save_plugin_config_sync(_CONTAINERS_MAP_KEY, data)


def _find_container(containers_map: dict, machine_id: int, container_name: str) -> Optional[dict]:
    """
    Locate a container entry in the persisted containers map.

    Args:
        containers_map: Full containers map as returned by :func:`_load_containers_map`.
        machine_id:     Machine primary key.
        container_name: Container directory name.

    Returns:
        Container dict, or ``None`` if not found.
    """
    machine_data = containers_map.get("machines", {}).get(str(machine_id))
    if not machine_data:
        return None
    return next(
        (c for c in machine_data.get("containers", []) if c["name"] == container_name),
        None,
    )


# ── Debug ─────────────────────────────────────────────────────────────────────

@router.get("/debug")
async def debug_containers_map():
    """
    Return a human-readable summary of the persisted container map.

    Useful for verifying what paths were discovered during the last scan
    without triggering a new SSH connection.
    """
    containers_map = _load_containers_map()
    summary = [
        {
            "machine_id":          mid,
            "machine_name":        mdata.get("machine_name"),
            "container":           c.get("name"),
            "path_keys":           list(c.get("paths", {}).keys()),
            "has_saved_arks":      "saved_arks" in c.get("paths", {}),
            "saved_arks_path":     c.get("paths", {}).get("saved_arks"),
            "saved_arks_contents": c.get("saved_arks_contents", []),
            "map_dirs":            c.get("map_dirs", []),
            "plugins":             c.get("plugins", []),
            "map_name":            c.get("map_name"),
            "profile_count":       c.get("profile_count", 0),
            "save_files":          c.get("save_files", []),
        }
        for mid, mdata in containers_map.get("machines", {}).items()
        for c in mdata.get("containers", [])
    ]
    return {
        "last_scan":        containers_map.get("last_scan"),
        "machines_count":   len(containers_map.get("machines", {})),
        "containers_summary": summary,
    }


# ── Scan endpoints ────────────────────────────────────────────────────────────

@router.post("/machines/{machine_id}/scan")
async def scan_machine_containers(machine_id: int, base_path: str = CONTAINER_BASE):
    """
    Scan all containers on a machine via SSH and persist the results.

    Connects to the remote host, lists all subdirectories under *base_path*,
    and runs a full discovery scan on each container.  Results are stored in
    the application database so subsequent reads do not require SSH.

    Args:
        machine_id: Primary key of the machine to scan.
        base_path:  Base directory that holds all container subdirectories.

    Returns:
        Number of containers found and their discovery data.
    """
    machine = _get_machine_or_404(machine_id)

    try:
        with _ssh_for_machine(machine) as ssh:
            containers = scan_containers(ssh, base_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SSH error: {exc}") from exc

    containers_map = _load_containers_map()
    containers_map["machines"][str(machine_id)] = {
        "machine_name": machine["name"],
        "hostname":     machine["hostname"],
        "base_path":    base_path,
        "containers":   containers,
        "scanned_at":   datetime.now(timezone.utc).isoformat(),
    }
    containers_map["last_scan"] = datetime.now(timezone.utc).isoformat()
    _save_containers_map(containers_map)

    return {
        "success":           True,
        "machine":           machine["name"],
        "containers_found":  len(containers),
        "containers":        containers,
    }


@router.get("/machines/{machine_id}/containers")
async def get_machine_containers(machine_id: int):
    """
    Return previously scanned container data for a machine (no SSH required).

    Args:
        machine_id: Primary key of the machine.

    Returns:
        Cached machine data dict, or an empty containers list with a hint
        message when no scan has been performed yet.
    """
    containers_map = _load_containers_map()
    machine_data = containers_map.get("machines", {}).get(str(machine_id))
    if not machine_data:
        return {
            "containers": [],
            "scanned_at": None,
            "message": "No scan data found. Run a scan first.",
        }
    return machine_data


@router.get("/containers")
async def get_all_containers():
    """
    Return all container entries across all scanned machines (no SSH required).

    Each container entry is annotated with its ``machine_id``, ``machine_name``,
    and ``hostname`` for display purposes.
    """
    containers_map = _load_containers_map()
    all_containers = [
        {
            **container,
            "machine_id":   int(mid),
            "machine_name": mdata.get("machine_name", ""),
            "hostname":     mdata.get("hostname", ""),
        }
        for mid, mdata in containers_map.get("machines", {}).items()
        for container in mdata.get("containers", [])
    ]
    return {
        "containers": all_containers,
        "last_scan":  containers_map.get("last_scan"),
        "total":      len(all_containers),
    }


@router.post("/machines/{machine_id}/containers/{container_name}/rescan")
async def rescan_container(
    machine_id: int,
    container_name: str,
    base_path: str = CONTAINER_BASE,
):
    """
    Re-scan a single container and update the persisted map entry.

    Useful when a container's contents have changed (e.g. new plugin installed)
    without needing to re-scan all containers on the machine.

    Args:
        machine_id:     Primary key of the machine.
        container_name: Directory name of the container to re-scan.
        base_path:      Root directory containing containers.
    """
    machine = _get_machine_or_404(machine_id)
    container_path = f"{base_path}/{container_name}"

    try:
        with _ssh_for_machine(machine) as ssh:
            updated_container = scan_single_container(ssh, container_name, container_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SSH error: {exc}") from exc

    containers_map = _load_containers_map()
    mid_key = str(machine_id)
    if mid_key in containers_map.get("machines", {}):
        containers = containers_map["machines"][mid_key].get("containers", [])
        for idx, c in enumerate(containers):
            if c["name"] == container_name:
                containers[idx] = updated_container
                break
        else:
            containers.append(updated_container)
        containers_map["machines"][mid_key]["containers"] = containers
        _save_containers_map(containers_map)

    return {"success": True, "container": updated_container}


# ── Plugin config file read/write ─────────────────────────────────────────────

class WriteConfigRequest(BaseModel):
    """Request body for writing a file to a remote container."""
    content: str
    backup: bool = True


@router.get("/machines/{machine_id}/containers/{container_name}/file")
async def read_container_file(
    machine_id: int,
    container_name: str,
    path_key: str,
):
    """
    Read a file from a container via SSH.

    The *path_key* must correspond to a key in the container's ``paths`` dict
    as discovered during the last scan (e.g. ``arkshop_config``, ``game_ini``).

    Returns the file content either as a parsed JSON object (``is_json: True``)
    or as a plain string (``is_json: False``).
    """
    machine = _get_machine_or_404(machine_id)
    containers_map = _load_containers_map()
    container = _find_container(containers_map, machine_id, container_name)
    if not container:
        raise HTTPException(status_code=404, detail="Container not found. Run a scan first.")

    file_path = container.get("paths", {}).get(path_key)
    if not file_path:
        raise HTTPException(
            status_code=404,
            detail=f"Path key '{path_key}' not found for this container.",
        )

    try:
        with _ssh_for_machine(machine) as ssh:
            content = read_remote_file(ssh, file_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Read error: {exc}") from exc

    if content is None:
        raise HTTPException(status_code=404, detail="File not found or empty.")

    try:
        parsed = json.loads(content)
        return {"path": file_path, "content": parsed, "is_json": True, "size": len(content)}
    except (json.JSONDecodeError, ValueError):
        return {"path": file_path, "content": content, "is_json": False, "size": len(content)}


@router.post("/machines/{machine_id}/containers/{container_name}/file")
async def write_container_file(
    machine_id: int,
    container_name: str,
    path_key: str,
    req: WriteConfigRequest,
):
    """
    Write content to a file in a container via SSH.

    When *backup* is True (default), a timestamped ``.bak`` copy of the
    existing file is created before the new content is written.

    Args:
        machine_id:     Primary key of the machine.
        container_name: Container directory name.
        path_key:       Path key from the container's ``paths`` dict.
        req:            Request body with ``content`` and optional ``backup`` flag.
    """
    machine = _get_machine_or_404(machine_id)
    containers_map = _load_containers_map()
    container = _find_container(containers_map, machine_id, container_name)
    if not container:
        raise HTTPException(status_code=404, detail="Container not found.")

    file_path = container.get("paths", {}).get(path_key)
    if not file_path:
        raise HTTPException(status_code=404, detail=f"Path key '{path_key}' not found.")

    try:
        with _ssh_for_machine(machine) as ssh:
            backup_path = backup_remote_file(ssh, file_path) if req.backup else None
            success = write_remote_file(ssh, file_path, req.content)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Write error: {exc}") from exc

    if not success:
        raise HTTPException(status_code=500, detail="Remote write command failed.")

    return {
        "success":     True,
        "path":        file_path,
        "backup_path": backup_path,
        "size":        len(req.content),
    }


@router.get("/machines/{machine_id}/containers/{container_name}/browse")
async def browse_container(
    machine_id: int,
    container_name: str,
    sub_path: str = "",
):
    """
    List files and directories inside a container path via SSH.

    The *sub_path* parameter is sanitised via ``posixpath.normpath`` and a
    strict prefix check to prevent path traversal attacks (``..`` tricks,
    ``....//``, absolute paths, etc.).

    Returns a list of entry dicts with ``name``, ``is_dir``, ``size``,
    ``modified``, and ``permissions`` fields.
    """
    machine = _get_machine_or_404(machine_id)
    containers_map = _load_containers_map()
    container = _find_container(containers_map, machine_id, container_name)
    if not container:
        raise HTTPException(status_code=404, detail="Container not found.")

    base_path = container["path"].rstrip("/")

    if sub_path:
        # Normalise with posixpath to collapse any .. and redundant slashes,
        # then verify the result stays strictly inside the container root.
        raw_combined = posixpath.normpath(f"{base_path}/{sub_path}")
        if not (
            raw_combined == base_path
            or raw_combined.startswith(base_path + "/")
        ):
            raise HTTPException(
                status_code=400,
                detail="Invalid sub_path: must remain within the container directory.",
            )
        target_path = raw_combined
    else:
        target_path = base_path

    try:
        with _ssh_for_machine(machine) as ssh:
            stdout, _, exit_code = ssh.execute(
                f'ls -la --time-style=long-iso "{target_path}" 2>/dev/null'
            )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SSH error: {exc}") from exc

    if exit_code != 0:
        raise HTTPException(status_code=404, detail="Path not found.")

    entries = []
    for line in stdout.strip().splitlines():
        if line.startswith("total") or not line.strip():
            continue
        parts = line.split(None, 7)
        if len(parts) < 8:
            continue
        permissions, _, _, _, size, date, time_str, name = (
            parts[0], parts[1], parts[2], parts[3],
            parts[4], parts[5], parts[6], parts[7],
        )
        if name in (".", ".."):
            continue
        entries.append({
            "name":        name,
            "is_dir":      permissions.startswith("d"),
            "size":        int(size) if size.isdigit() else 0,
            "modified":    f"{date} {time_str}",
            "permissions": permissions,
        })

    return {"path": target_path, "sub_path": sub_path, "entries": entries}
