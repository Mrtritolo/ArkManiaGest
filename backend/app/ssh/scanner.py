"""
ssh/scanner.py — Container discovery via SSH.

Scans game server containers on a remote Linux host and automatically
discovers all relevant directory paths for plugins, configurations, and
save data.  Uses POSIX ``find`` commands so it adapts to non-standard
directory layouts without requiring configuration.
"""

import re
import json
from datetime import datetime, timezone
from typing import Dict, List, Optional

from app.ssh.manager import SSHManager

# Default base directory for all game containers on ServerForge hosts
CONTAINER_BASE = "/gameadmin/containers"

# Directory name fragments that indicate a non-map subdirectory in SavedArks
_NON_MAP_DIR_FRAGMENTS = ("backup", "temp", "old", "logs", "config")

# Container directory names to skip during the scan.  ``bobsmissions`` runs
# the BobsMissions standalone map (story content, no player data we need
# to manage) and only adds noise to the player/profile dashboards -- the
# operator wants it hidden from the panel.  Match is case-insensitive on
# the trimmed directory name.
_EXCLUDED_CONTAINER_NAMES = frozenset({"bobsmissions"})


def _is_excluded_container(name: str) -> bool:
    return name.strip().lower() in _EXCLUDED_CONTAINER_NAMES


def scan_containers(ssh: SSHManager, base_path: str = CONTAINER_BASE) -> List[Dict]:
    """
    Scan all containers present under *base_path* on the remote host.

    Each subdirectory of *base_path* is treated as a separate container and
    passed to :func:`scan_single_container` for detailed discovery.

    Args:
        ssh:       Connected :class:`~app.ssh.manager.SSHManager` instance.
        base_path: Absolute path to the directory that holds all containers.

    Returns:
        List of container info dicts (one per subdirectory).  Returns an
        empty list if the directory is missing or unreadable.
    """
    stdout, _stderr, exit_code = ssh.execute(f'ls -1 "{base_path}" 2>/dev/null')
    if exit_code != 0 or not stdout.strip():
        return []

    container_names = [
        n.strip() for n in stdout.strip().splitlines()
        if n.strip() and not _is_excluded_container(n.strip())
    ]
    return [
        scan_single_container(ssh, name, f"{base_path}/{name}")
        for name in container_names
    ]


def scan_single_container(ssh: SSHManager, name: str, path: str) -> Dict:
    """
    Perform a full discovery scan for a single game server container.

    Discovery steps (in order):
      1. Locate the ARK server root (directory containing ``ShooterGame``).
      2. Find ``Game.ini`` and ``GameUserSettings.ini`` config files.
      3. Find the ``SavedArks`` directory and its subdirectories (map dirs).
      4. Locate the ``ArkApi/Plugins`` directory.
      5. List installed plugins and their ``config.json`` paths.
      6. Count ``.arkprofile`` files and detect map names from ``.ark`` saves.
      7. Read the session name from ``GameUserSettings.ini``.
      8. Check whether the server process is currently running.

    Args:
        ssh:  Connected :class:`~app.ssh.manager.SSHManager` instance.
        name: Container directory name (used as identifier).
        path: Absolute path to the container root directory.

    Returns:
        Dict with keys: ``name``, ``path``, ``server_root``, ``paths``,
        ``plugins``, ``map_name``, ``save_files``, ``config_files``,
        ``process_running``, ``status``, and optional ``saved_arks_contents``,
        ``map_dirs``, ``profile_count``, ``server_name``.
    """
    result: Dict = {
        "name": name,
        "path": path,
        "server_root": None,
        "paths": {},
        "plugins": [],
        "map_name": None,
        "save_files": [],
        "config_files": [],
        "process_running": False,
        "status": "scanned",
    }

    # ── Step 1: Locate the ShooterGame root ──────────────────────────────
    shooter_game = _find_shooter_game(ssh, path)
    if shooter_game:
        result["server_root"] = shooter_game.rsplit("/ShooterGame", 1)[0]
        result["paths"]["shooter_game"] = shooter_game

    sg_path: str = result["paths"].get("shooter_game", "")

    # ── Step 2: Config INI files ──────────────────────────────────────────
    if sg_path:
        for ini_filename in ("Game.ini", "GameUserSettings.ini"):
            stdout, _, _ = ssh.execute(
                f'find "{sg_path}" -maxdepth 5 -name "{ini_filename}" 2>/dev/null | head -1'
            )
            if stdout.strip():
                key = ini_filename.lower().replace(".", "_")
                result["paths"][key] = stdout.strip()

    # ── Step 3: SavedArks directory ───────────────────────────────────────
    _discover_saved_arks(ssh, path, sg_path, result)

    # Logs directory (informational only)
    if sg_path:
        stdout, _, _ = ssh.execute(
            f'find "{sg_path}" -maxdepth 4 -type d -name "Logs" 2>/dev/null | head -1'
        )
        if stdout.strip():
            result["paths"]["logs"] = stdout.strip()

    # ── Step 4: ArkApi/Plugins directory ─────────────────────────────────
    _discover_plugins_dir(ssh, path, result)

    # ── Step 5: Per-plugin config.json paths ─────────────────────────────
    _discover_plugin_configs(ssh, result)

    # ── Steps 6–7: Save files, profiles, session name ────────────────────
    _discover_save_data(ssh, result)

    # ── Step 8: Running process check ────────────────────────────────────
    result["process_running"] = _is_process_running(ssh, name)

    return result


# ── Internal discovery helpers ────────────────────────────────────────────────

def _find_shooter_game(ssh: SSHManager, container_path: str) -> Optional[str]:
    """
    Return the absolute path to the ``ShooterGame`` directory inside the container.

    Searches up to 4 directory levels deep; also checks the container root
    directly as a fallback.

    Args:
        ssh:            Connected SSH manager.
        container_path: Absolute path to the container root.

    Returns:
        Full path string, or ``None`` if not found.
    """
    stdout, _, _ = ssh.execute(
        f'find "{container_path}" -maxdepth 4 -type d -name "ShooterGame" 2>/dev/null | head -1'
    )
    if stdout.strip():
        return stdout.strip()

    # Direct child fallback
    stdout2, _, _ = ssh.execute(
        f'test -d "{container_path}/ShooterGame" && echo "yes" 2>/dev/null'
    )
    return f"{container_path}/ShooterGame" if stdout2.strip() == "yes" else None


def _discover_saved_arks(
    ssh: SSHManager,
    container_path: str,
    sg_path: str,
    result: Dict,
) -> None:
    """
    Populate ``result["paths"]["saved_arks"]`` and related map-discovery fields.

    Search strategy (first match wins):
      1. Find a ``SavedArks`` directory under ShooterGame or the container root.
      2. Fall back to the parent directory of the first ``.arkprofile`` found.

    Side effects:
        Writes to ``result["paths"]``, ``result["saved_arks_contents"]``,
        ``result["map_dirs"]``, ``result["map_name"]``, ``result["save_files"]``,
        and ``result["profile_count"]``.

    Args:
        ssh:            Connected SSH manager.
        container_path: Container root path.
        sg_path:        ShooterGame directory path (may be empty string).
        result:         Mutable result dict being assembled by the caller.
    """
    search_bases = [b for b in (sg_path, container_path) if b]
    for base in search_bases:
        stdout, _, _ = ssh.execute(
            f'find "{base}" -maxdepth 5 -type d -name "SavedArks" 2>/dev/null | head -1'
        )
        if stdout.strip():
            result["paths"]["saved_arks"] = stdout.strip()
            break

    # Fallback: derive SavedArks path from the location of the first .arkprofile
    if "saved_arks" not in result["paths"]:
        stdout, _, _ = ssh.execute(
            f'find "{container_path}" -maxdepth 6 -name "*.arkprofile" -type f 2>/dev/null | head -1'
        )
        if stdout.strip():
            result["paths"]["saved_arks"] = stdout.strip().rsplit("/", 1)[0]


def _discover_plugins_dir(ssh: SSHManager, container_path: str, result: Dict) -> None:
    """
    Locate the ``Plugins`` directory and store it under ``result["paths"]``.

    Priority order for candidate Plugins directories:
      1. Parent named ``ArkApi`` (canonical ARK API path)
      2. Parent named ``API`` (alternative naming)
      3. Any other ``Plugins`` directory found

    Side effects:
        Writes ``result["paths"]["arkapi_plugins"]`` and
        ``result["paths"]["api_root"]`` when a candidate is found.

    Args:
        ssh:            Connected SSH manager.
        container_path: Container root path.
        result:         Mutable result dict.
    """
    stdout, _, _ = ssh.execute(
        f'find "{container_path}" -maxdepth 8 -type d -name "Plugins" 2>/dev/null'
    )
    if not stdout.strip():
        return

    candidates = [c.strip() for c in stdout.strip().splitlines() if c.strip()]
    best: Optional[str] = None

    for candidate in candidates:
        parent_name = candidate.rsplit("/", 1)[0].split("/")[-1] if "/" in candidate else ""
        if parent_name.lower() == "arkapi":
            best = candidate
            break
        if parent_name.upper() == "API" and best is None:
            best = candidate

    if best is None:
        best = candidates[0]

    result["paths"]["arkapi_plugins"] = best
    result["paths"]["api_root"] = best.rsplit("/Plugins", 1)[0]


def _discover_plugin_configs(ssh: SSHManager, result: Dict) -> None:
    """
    List plugins installed in the ``arkapi_plugins`` directory and record
    the path to each plugin's ``config.json``.

    Side effects:
        Populates ``result["plugins"]`` and appends to ``result["config_files"]``.
        Adds ``plugin_<n>_config`` keys to ``result["paths"]``.

    Args:
        ssh:    Connected SSH manager.
        result: Mutable result dict (must have ``paths.arkapi_plugins`` populated).
    """
    plugins_dir = result["paths"].get("arkapi_plugins")
    if not plugins_dir:
        return

    stdout, _, _ = ssh.execute(f'ls -1 "{plugins_dir}" 2>/dev/null')
    if not stdout.strip():
        return

    result["plugins"] = [p.strip() for p in stdout.strip().splitlines() if p.strip()]

    for plugin_name in result["plugins"]:
        config_path = f"{plugins_dir}/{plugin_name}/config.json"
        stdout, _, _ = ssh.execute(f'test -f "{config_path}" && echo "EXISTS" 2>/dev/null')
        if stdout.strip() == "EXISTS":
            config_key = f"plugin_{plugin_name.lower()}_config"
            result["paths"][config_key] = config_path
            result["config_files"].append({
                "plugin": plugin_name,
                "file":   "config.json",
                "path":   config_path,
                "key":    config_key,
            })


def _discover_save_data(ssh: SSHManager, result: Dict) -> None:
    """
    Populate save-data-related fields from the ``SavedArks`` directory.

    Discovers:
      - Directory listing of SavedArks (``saved_arks_contents``)
      - Map subdirectories (``map_dirs``) and primary map name (``map_name``)
      - ``.ark`` save file names (``save_files``)
      - Total ``.arkprofile`` count (``profile_count``)
      - Server session name from ``GameUserSettings.ini`` (``server_name``)

    Args:
        ssh:    Connected SSH manager.
        result: Mutable result dict (must have ``paths`` populated).
    """
    saved_arks = result["paths"].get("saved_arks")
    if not saved_arks:
        return

    # Top-level listing
    stdout, _, _ = ssh.execute(f'ls -1 "{saved_arks}" 2>/dev/null')
    if stdout.strip():
        result["saved_arks_contents"] = [e.strip() for e in stdout.strip().splitlines() if e.strip()]

    # Map subdirectories (skip backup/temp/old/logs/config dirs)
    stdout, _, _ = ssh.execute(
        f'find "{saved_arks}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null'
    )
    if stdout.strip():
        map_dirs = []
        for subdir in (d.strip() for d in stdout.strip().splitlines() if d.strip()):
            dir_name = subdir.split("/")[-1]
            if not any(frag in dir_name.lower() for frag in _NON_MAP_DIR_FRAGMENTS):
                map_dirs.append({"name": dir_name, "path": subdir})
        result["map_dirs"] = map_dirs
        if map_dirs:
            result["map_name"] = map_dirs[0]["name"]

    # .ark save files (exclude backups, temp files, anti-corruption copies)
    stdout, _, _ = ssh.execute(
        f'find "{saved_arks}" -maxdepth 3 -name "*.ark" '
        f'-not -name "*.tmp" '
        f'-not -name "*backup*" '
        f'-not -name "*_old*" '
        f'-not -name "*AntiCorruption*" '
        f'2>/dev/null | head -10'
    )
    if stdout.strip():
        ark_files = [l.strip() for l in stdout.strip().splitlines() if l.strip()]
        result["save_files"] = [f.split("/")[-1] for f in ark_files]
        # Derive map name from the first clean .ark filename if not yet set
        if not result.get("map_name"):
            for ark_path in ark_files:
                fname = ark_path.split("/")[-1].replace(".ark", "")
                if not any(x in fname.lower() for x in ("backup", "temp", "old", "_new", "anticorruption")):
                    result["map_name"] = fname
                    break

    # Profile count
    stdout, _, _ = ssh.execute(
        f'find "{saved_arks}" -maxdepth 3 -name "*.arkprofile" -type f 2>/dev/null | wc -l'
    )
    if stdout.strip().isdigit():
        result["profile_count"] = int(stdout.strip())

    # Session name from GameUserSettings.ini
    gus_path = result["paths"].get("gameusersettings_ini")
    if gus_path:
        stdout, _, _ = ssh.execute(
            f'grep -i "^SessionName=" "{gus_path}" 2>/dev/null | head -1'
        )
        if stdout.strip():
            match = re.search(r"SessionName=(.*)", stdout.strip(), re.IGNORECASE)
            if match:
                result["server_name"] = match.group(1).strip()


def _is_process_running(ssh: SSHManager, container_name: str) -> bool:
    """
    Check whether the ARK server process is currently running for a container.

    Uses ``pgrep`` with two fallback patterns:
      1. Process command line matching both ``ShooterGame`` and the container name.
      2. Any ARK/ShooterGame process that matches the container name.

    Args:
        ssh:            Connected SSH manager.
        container_name: Container directory name used as a pgrep filter.

    Returns:
        True if at least one matching process is found.
    """
    stdout, _, _ = ssh.execute(
        f'pgrep -a -f "ShooterGame.*{container_name}" 2>/dev/null | head -1'
    )
    if stdout.strip():
        return True

    stdout, _, _ = ssh.execute(
        f'pgrep -a -f "{container_name}" 2>/dev/null '
        f'| grep -i "shooter\\|ark\\|server" | head -1'
    )
    return bool(stdout.strip())


# ── Remote file I/O helpers ───────────────────────────────────────────────────

def read_remote_file(ssh: SSHManager, remote_path: str) -> Optional[str]:
    """
    Read the full text content of a remote file via SSH.

    Args:
        ssh:         Connected SSH manager.
        remote_path: Absolute path to the remote file.

    Returns:
        File content string, or ``None`` if the file does not exist or is empty.
    """
    stdout, _stderr, exit_code = ssh.execute(f'cat "{remote_path}" 2>/dev/null')
    return stdout if exit_code == 0 and stdout else None


def write_remote_file(ssh: SSHManager, remote_path: str, content: str) -> bool:
    """
    Write text content to a remote file via SSH.

    The content is base64-encoded before transmission to avoid shell quoting
    issues with special characters.

    Args:
        ssh:         Connected SSH manager.
        remote_path: Absolute path of the remote destination file.
        content:     UTF-8 text content to write.

    Returns:
        True on success, False if the remote command returned a non-zero exit code.
    """
    import base64
    encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
    # _stdout is empty for a redirect-only command; _stderr captures any error message.
    _stdout, _stderr, exit_code = ssh.execute(
        f'echo "{encoded}" | base64 -d > "{remote_path}"'
    )
    return exit_code == 0


def backup_remote_file(ssh: SSHManager, remote_path: str) -> Optional[str]:
    """
    Create a timestamped ``.bak.<timestamp>`` backup copy of a remote file.

    Args:
        ssh:         Connected SSH manager.
        remote_path: Absolute path to the file to back up.

    Returns:
        Absolute path of the backup file on success, or ``None`` on failure.
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_path = f"{remote_path}.bak.{timestamp}"
    _, _, exit_code = ssh.execute(f'cp "{remote_path}" "{backup_path}" 2>/dev/null')
    return backup_path if exit_code == 0 else None
