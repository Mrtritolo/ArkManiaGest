"""
api/routes/game_config.py — INI config editor for ASA game servers.

Loads, parses, modifies, and saves the two main INI files used by every
ARK: Survival Ascended dedicated server:
  - GameUserSettings.ini
  - Game.ini

Also provides specialised endpoints for the complex repeatable overrides
(stack sizes, supply crate loot, crafting costs, NPC replacements, spawn
entries).

Handlers are plain ``def``: every one of them does blocking SSH and store
I/O, which FastAPI then runs in its threadpool instead of on the event loop.
"""
import re
import shlex
from datetime import datetime, timezone
from typing import Any, Callable, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import require_operator, require_viewer
from app.core.config import server_settings
from app.core.store import get_machine_sync, get_containers_map_sync
from app.ssh.manager import SSHManager
from app.ssh.scanner import write_remote_file, backup_remote_file
from app.ssh.ini_parser import (
    parse_ini, write_ini, apply_changes,
    parse_stack_override, build_stack_override,
    parse_crafting_override, build_crafting_override,
    parse_npc_replacement, build_npc_replacement,
    get_setting_definitions, get_current_values, get_all_overrides,
    SETTING_GROUPS, OVERRIDE_KEYS,
)

router = APIRouter()

# Passwords never sent to non-admins.  UE config keys are case-insensitive
# and may carry an array-operation prefix (+Key=, .Key=, -Key=).
_SECRET_MASK    = "********"
_SECRET_LINE_RE = re.compile(
    r"^(\s*[+.!-]?(ServerAdminPassword|ServerPassword|SpectatorPassword)\s*=)([^\r\n]*)",
    re.IGNORECASE | re.MULTILINE,
)


# ── Private helpers ────────────────────────────────────────────────────────────

def _get_machine_or_404(machine_id: int) -> dict:
    """
    Fetch a machine dict from the store.

    Raises:
        HTTPException 404: Machine not found.
    """
    m = get_machine_sync(machine_id)
    if not m:
        raise HTTPException(status_code=404, detail="Machine not found.")
    return m


def _ssh_for_machine(m: dict) -> SSHManager:
    """
    Build an SSH manager from a machine dict.

    The SSH timeout is sourced from :attr:`server_settings.SSH_TIMEOUT` so
    that a single .env change propagates everywhere.
    """
    return SSHManager(
        host=m["hostname"],
        username=m["ssh_user"],
        password=m.get("ssh_password"),
        key_path=m.get("ssh_key_path"),
        port=m.get("ssh_port", 22),
        timeout=server_settings.SSH_TIMEOUT,
    )


def _get_containers_map() -> dict:
    """Load the scanned container map from the settings DB (with exclusion filter)."""
    return get_containers_map_sync()


def _find_container(cmap: dict, machine_id: int, container_name: str) -> Optional[dict]:
    """
    Locate a container entry in the container map.

    Args:
        cmap:           Container map dict from the settings DB.
        machine_id:     Machine primary key.
        container_name: Container directory name.

    Returns:
        Container dict, or None if not found.
    """
    machine_data = cmap.get("machines", {}).get(str(machine_id))
    if not machine_data:
        return None
    return next(
        (c for c in machine_data.get("containers", []) if c["name"] == container_name),
        None,
    )


def _find_uncategorized(ini, file_ref: str) -> dict[str, list[dict]]:
    """
    Find INI settings that exist in the file but are not listed in any of the
    known setting groups (i.e. they are mod-specific or unknown keys).

    Args:
        ini:      Parsed IniFile object.
        file_ref: ``"gus"`` or ``"game"``.

    Returns:
        Dict mapping section name → list of {key, value} dicts.
    """
    categorized: dict[str, set[str]] = {}
    for group in SETTING_GROUPS.values():
        for key, meta in group["settings"].items():
            if meta["file"] == file_ref:
                sect_lower = meta["section"].lower()
                categorized.setdefault(sect_lower, set()).add(key)

    uncategorized: dict[str, list[dict]] = {}
    for section_name, section in ini.sections.items():
        if section.is_readonly:
            continue
        known    = categorized.get(section_name.lower(), set())
        unknowns = [
            {"key": e.key, "value": e.value}
            for e in section.entries
            if not e.is_comment and not e.is_blank
            and e.key not in known
            and e.key not in OVERRIDE_KEYS
        ]
        if unknowns:
            uncategorized[section_name] = unknowns

    return uncategorized


def _mask_secrets(content: str) -> str:
    """Replace every non-empty password value in raw INI text with the mask."""
    return _SECRET_LINE_RE.sub(
        lambda m: m.group(1) + (_SECRET_MASK if m.group(3) else ""), content,
    )


def _restore_secrets(content: str, current: str) -> str:
    """
    Put the live value back on password lines that still carry the mask.

    Non-admins only ever see masked passwords, so saving that view (raw
    editor or structured form) must not write the mask over the real value.
    A key can appear in several sections with different values, so the n-th
    line of a key gets the n-th live value of that key, not the first one.
    """
    live: dict[str, list[str]] = {}
    for m in _SECRET_LINE_RE.finditer(current):
        live.setdefault(m.group(2).lower(), []).append(m.group(3))
    seen: dict[str, int] = {}

    def restore(m: re.Match) -> str:
        key = m.group(2).lower()
        n   = seen.get(key, 0)
        seen[key] = n + 1
        if m.group(3) != _SECRET_MASK:
            return m.group(0)
        values = live.get(key, [])
        return m.group(1) + (values[n] if n < len(values) else "")

    return _SECRET_LINE_RE.sub(restore, content)


def _read_ini(ssh: SSHManager, path: str) -> str:
    """
    Read an INI file, raising when it cannot be read.

    ``read_remote_file`` returns None for a failed ``cat`` as well as for an
    empty file; parsing a failed read as "" made a save rewrite the whole
    file from just the changed keys.
    """
    stdout, stderr, exit_code = ssh.execute(f"cat {shlex.quote(path)}")
    if exit_code != 0:
        raise HTTPException(
            status_code=500,
            detail=f"Could not read {path}: {stderr or f'exit code {exit_code}'}",
        )
    return stdout


def _write_ini(
    ssh: SSHManager, path: str, content: str, current: str, backup: bool,
) -> Optional[str]:
    """
    Overwrite an INI file, optionally after a timestamped backup.

    Masked passwords get their live value back first.  A failed backup
    aborts before anything is written, and a failed write raises instead of
    being reported as saved.

    Returns:
        The backup path, or None when *backup* is False.
    """
    content     = _restore_secrets(content, current)
    backup_path = None
    if backup:
        backup_path = backup_remote_file(ssh, path)
        if not backup_path:
            raise HTTPException(
                status_code=500,
                detail=f"Backup of {path} failed; the file was not changed.",
            )
    if not write_remote_file(ssh, path, content):
        raise HTTPException(status_code=500, detail=f"Writing {path} failed.")
    return backup_path


# ── Request schemas ────────────────────────────────────────────────────────────

class SaveConfigRequest(BaseModel):
    gus_changes:  dict[str, dict[str, Any]] = {}
    game_changes: dict[str, dict[str, Any]] = {}
    backup:       bool = True


class SaveRawRequest(BaseModel):
    file:    Literal["gus", "game"]
    content: str
    backup:  bool = True


class StackOverrideItem(BaseModel):
    item_class:        str
    max_quantity:      int
    ignore_multiplier: bool = True


class SaveStacksRequest(BaseModel):
    items:  list[StackOverrideItem]
    backup: bool = True


class CraftingResource(BaseModel):
    resource_class: str
    amount:         float
    exact_type:     bool = False


class CraftingOverrideItem(BaseModel):
    item_class: str
    resources:  list[CraftingResource]


class SaveCraftingRequest(BaseModel):
    items:  list[CraftingOverrideItem]
    backup: bool = True


class NpcReplacementItem(BaseModel):
    from_class: str
    to_class:   str


class SaveNpcReplacementsRequest(BaseModel):
    items:  list[NpcReplacementItem]
    backup: bool = True


class SaveOverrideRawRequest(BaseModel):
    key:    str       # e.g. "ConfigOverrideSupplyCrateItems"
    values: list[str] # list of raw override lines
    backup: bool = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/definitions")
async def get_definitions():
    """Return all setting group definitions used by the frontend controls."""
    return {"groups": get_setting_definitions()}


@router.get("/machines/{machine_id}/containers/{container_name}/config")
def load_config(
    machine_id: int, container_name: str, user: dict = Depends(require_viewer),
):
    """
    Load and parse both INI files from a container.

    Returns the current values for all known settings, all complex overrides,
    mod-specific sections, and uncategorized keys — plus the raw file content
    for advanced editing.  Passwords are masked for non-admins everywhere in
    the response.
    """
    machine   = _get_machine_or_404(machine_id)
    cmap      = _get_containers_map()
    container = _find_container(cmap, machine_id, container_name)
    if not container:
        raise HTTPException(
            status_code=404,
            detail="Container not found. Run a scan first.",
        )

    gus_path  = container.get("paths", {}).get("gameusersettings_ini")
    game_path = container.get("paths", {}).get("game_ini")

    if not gus_path and not game_path:
        raise HTTPException(
            status_code=404,
            detail="INI files not found. Re-scan the container.",
        )

    gus_content  = ""
    game_content = ""

    try:
        with _ssh_for_machine(machine) as ssh:
            if gus_path:
                gus_content  = _read_ini(ssh, gus_path)
            if game_path:
                game_content = _read_ini(ssh, game_path)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SSH error: {exc}")

    if user["role"] != "admin":
        gus_content  = _mask_secrets(gus_content)
        game_content = _mask_secrets(game_content)

    gus_ini  = parse_ini(gus_content)
    game_ini = parse_ini(game_content)

    return {
        "container_name": container_name,
        "map_name":       container.get("map_name", ""),
        "paths":          {"gus": gus_path, "game": game_path},
        "values":         get_current_values(gus_ini, game_ini),
        "overrides":      get_all_overrides(game_ini),
        "mod_sections":   {"gus": gus_ini.mod_sections(), "game": game_ini.mod_sections()},
        "uncategorized":  {
            "gus":  _find_uncategorized(gus_ini,  "gus"),
            "game": _find_uncategorized(game_ini, "game"),
        },
        "raw":            {"gus": gus_content, "game": game_content},
        "loaded_at":      datetime.now(timezone.utc).isoformat(),
    }


@router.post(
    "/machines/{machine_id}/containers/{container_name}/config",
    dependencies=[Depends(require_operator)],
)
def save_config(machine_id: int, container_name: str, req: SaveConfigRequest):
    """Save structured setting changes to one or both INI files."""
    machine   = _get_machine_or_404(machine_id)
    cmap      = _get_containers_map()
    container = _find_container(cmap, machine_id, container_name)
    if not container:
        raise HTTPException(status_code=404, detail="Container not found.")

    gus_path  = container.get("paths", {}).get("gameusersettings_ini")
    game_path = container.get("paths", {}).get("game_ini")
    # Changes for a file the scan did not find used to be dropped while the
    # response still said the save succeeded.
    if (req.gus_changes and not gus_path) or (req.game_changes and not game_path):
        raise HTTPException(
            status_code=404,
            detail="INI file path not found. Re-scan the container.",
        )
    results: dict = {"gus": None, "game": None, "backups": []}

    try:
        with _ssh_for_machine(machine) as ssh:
            if req.gus_changes:
                current     = _read_ini(ssh, gus_path)
                new_content = write_ini(apply_changes(parse_ini(current), req.gus_changes))
                bp = _write_ini(ssh, gus_path, new_content, current, req.backup)
                if bp:
                    results["backups"].append(bp)
                results["gus"] = {"success": True, "path": gus_path, "size": len(new_content)}

            if req.game_changes:
                current     = _read_ini(ssh, game_path)
                new_content = write_ini(apply_changes(parse_ini(current), req.game_changes))
                bp = _write_ini(ssh, game_path, new_content, current, req.backup)
                if bp:
                    results["backups"].append(bp)
                results["game"] = {"success": True, "path": game_path, "size": len(new_content)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SSH error: {exc}")

    return {
        "success":  True,
        "results":  results,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post(
    "/machines/{machine_id}/containers/{container_name}/config/raw",
    dependencies=[Depends(require_operator)],
)
def save_raw_config(machine_id: int, container_name: str, req: SaveRawRequest):
    """Write raw INI content directly (advanced editor)."""
    machine   = _get_machine_or_404(machine_id)
    cmap      = _get_containers_map()
    container = _find_container(cmap, machine_id, container_name)
    if not container:
        raise HTTPException(status_code=404, detail="Container not found.")

    path_key  = "gameusersettings_ini" if req.file == "gus" else "game_ini"
    file_path = container.get("paths", {}).get(path_key)
    if not file_path:
        raise HTTPException(status_code=404, detail=f"Path for '{req.file}' not found.")

    try:
        with _ssh_for_machine(machine) as ssh:
            current     = _read_ini(ssh, file_path)
            backup_path = _write_ini(ssh, file_path, req.content, current, req.backup)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SSH error: {exc}")

    return {
        "success":     True,
        "file":        req.file,
        "path":        file_path,
        "backup_path": backup_path,
        "size":        len(req.content),
    }


@router.post(
    "/machines/{machine_id}/containers/{container_name}/config/stacks",
    dependencies=[Depends(require_operator)],
)
def save_stack_overrides(
    machine_id: int, container_name: str, req: SaveStacksRequest,
):
    """Save ConfigOverrideItemMaxQuantity entries to Game.ini."""
    values = [
        build_stack_override({
            "class":             i.item_class,
            "max_quantity":      i.max_quantity,
            "ignore_multiplier": i.ignore_multiplier,
        })
        for i in req.items
    ]
    return _save_override_list(
        machine_id, container_name,
        "ConfigOverrideItemMaxQuantity", values, req.backup,
        keep_unparsed=parse_stack_override,
    )


@router.post(
    "/machines/{machine_id}/containers/{container_name}/config/crafting",
    dependencies=[Depends(require_operator)],
)
def save_crafting_overrides(
    machine_id: int, container_name: str, req: SaveCraftingRequest,
):
    """Save ConfigOverrideItemCraftingCosts entries to Game.ini."""
    values = [
        build_crafting_override({
            "item_class": c.item_class,
            "resources":  [
                {
                    "resource_class": r.resource_class,
                    "amount":         r.amount,
                    "exact_type":     r.exact_type,
                }
                for r in c.resources
            ],
        })
        for c in req.items
    ]
    return _save_override_list(
        machine_id, container_name,
        "ConfigOverrideItemCraftingCosts", values, req.backup,
        keep_unparsed=parse_crafting_override,
    )


@router.post(
    "/machines/{machine_id}/containers/{container_name}/config/npc-replacements",
    dependencies=[Depends(require_operator)],
)
def save_npc_replacements(
    machine_id: int, container_name: str, req: SaveNpcReplacementsRequest,
):
    """Save NPCReplacements entries to Game.ini."""
    values = [
        build_npc_replacement({"from_class": i.from_class, "to_class": i.to_class})
        for i in req.items
    ]
    return _save_override_list(
        machine_id, container_name, "NPCReplacements", values, req.backup,
        keep_unparsed=parse_npc_replacement,
    )


@router.post(
    "/machines/{machine_id}/containers/{container_name}/config/override-raw",
    dependencies=[Depends(require_operator)],
)
def save_override_raw(
    machine_id: int, container_name: str, req: SaveOverrideRawRequest,
):
    """
    Save raw override lines for a complex key (supply crate, spawn entries, …).

    Raises:
        HTTPException 400: Key is not a valid override key.
    """
    if req.key not in OVERRIDE_KEYS:
        raise HTTPException(
            status_code=400,
            detail=f"'{req.key}' is not a valid override key.",
        )
    return _save_override_list(
        machine_id, container_name, req.key, req.values, req.backup,
    )


# ── Shared override helper ─────────────────────────────────────────────────────

def _save_override_list(
    machine_id:     int,
    container_name: str,
    key:            str,
    values:         list[str],
    backup:         bool,
    keep_unparsed:  Optional[Callable[[str], Optional[dict]]] = None,
) -> dict:
    """
    Replace all entries for a repeatable INI key in Game.ini.

    Args:
        machine_id:     Machine primary key.
        container_name: Container directory name.
        key:            INI key to replace (e.g. ``ConfigOverrideItemMaxQuantity``).
        values:         New list of raw value strings.
        backup:         Create a timestamped backup before writing.
        keep_unparsed:  Parser behind a typed editor.  Existing lines it cannot
                        parse never reach that editor, so they are kept as
                        they are instead of being deleted by the replace.

    Returns:
        Result dict with success flag, key name, count, and timestamp.

    Raises:
        HTTPException 400: A value spans more than one line, which would
                           split into stray lines in Game.ini, or a typed
                           value its own parser cannot read back.
    """
    if any("\n" in v or "\r" in v for v in values):
        raise HTTPException(
            status_code=400,
            detail=f"Each {key} entry must be a single line.",
        )
    if keep_unparsed:
        # Unparsed lines are kept on every later typed save, so a malformed
        # row written here could only be removed from the Raw tab.
        for n, v in enumerate(values, start=1):
            if keep_unparsed(v) is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Entry {n} of {key} is incomplete or malformed.",
                )

    machine   = _get_machine_or_404(machine_id)
    cmap      = _get_containers_map()
    container = _find_container(cmap, machine_id, container_name)
    if not container:
        raise HTTPException(status_code=404, detail="Container not found.")

    game_path = container.get("paths", {}).get("game_ini")
    if not game_path:
        raise HTTPException(status_code=404, detail="Game.ini path not found.")

    try:
        with _ssh_for_machine(machine) as ssh:
            current  = _read_ini(ssh, game_path)
            game_ini = parse_ini(current)
            section  = (
                game_ini.get_section("/script/shootergame.shootergamemode")
                or game_ini.ensure_section("/script/shootergame.shootergamemode")
            )
            if keep_unparsed:
                values = [
                    v for v in section.get_all(key) if keep_unparsed(v) is None
                ] + values
            section.set_all(key, values)
            _write_ini(ssh, game_path, write_ini(game_ini), current, backup)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SSH error: {exc}")

    return {
        "success":  True,
        "key":      key,
        "count":    len(values),
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
