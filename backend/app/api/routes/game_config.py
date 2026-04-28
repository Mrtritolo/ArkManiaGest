"""
api/routes/game_config.py — INI config editor for ASA game servers.

Loads, parses, modifies, and saves the two main INI files used by every
ARK: Survival Ascended dedicated server:
  - GameUserSettings.ini
  - Game.ini

Also provides specialised endpoints for the complex repeatable overrides
(stack sizes, supply crate loot, crafting costs, NPC replacements, spawn
entries).
"""
import json
from datetime import datetime, timezone
from typing import Optional, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import server_settings
from app.core.store import get_machine_sync, get_plugin_config_sync, get_containers_map_sync
from app.ssh.manager import SSHManager
from app.ssh.scanner import read_remote_file, write_remote_file, backup_remote_file
from app.ssh.ini_parser import (
    parse_ini, write_ini, apply_changes,
    parse_stack_override, build_stack_override,
    parse_supply_crate_override,
    parse_crafting_override, build_crafting_override,
    parse_npc_replacement, build_npc_replacement,
    get_setting_definitions, get_current_values, get_all_overrides,
    SETTING_GROUPS, READONLY_SECTIONS, OVERRIDE_KEYS,
)

router = APIRouter()

# Settings key for the scanned container map
_CONTAINERS_MAP_KEY = "containers_map"


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


# ── Request schemas ────────────────────────────────────────────────────────────

class SaveConfigRequest(BaseModel):
    gus_changes:  dict[str, dict[str, Any]] = {}
    game_changes: dict[str, dict[str, Any]] = {}
    backup:       bool = True


class SaveRawRequest(BaseModel):
    file:    str   # "gus" or "game"
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
async def load_config(machine_id: int, container_name: str):
    """
    Load and parse both INI files from a container.

    Returns the current values for all known settings, all complex overrides,
    mod-specific sections, and uncategorized keys — plus the raw file content
    for advanced editing.
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
                gus_content  = read_remote_file(ssh, gus_path)  or ""
            if game_path:
                game_content = read_remote_file(ssh, game_path) or ""
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SSH error: {exc}")

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


@router.post("/machines/{machine_id}/containers/{container_name}/config")
async def save_config(machine_id: int, container_name: str, req: SaveConfigRequest):
    """Save structured setting changes to one or both INI files."""
    machine   = _get_machine_or_404(machine_id)
    cmap      = _get_containers_map()
    container = _find_container(cmap, machine_id, container_name)
    if not container:
        raise HTTPException(status_code=404, detail="Container not found.")

    gus_path  = container.get("paths", {}).get("gameusersettings_ini")
    game_path = container.get("paths", {}).get("game_ini")
    results: dict = {"gus": None, "game": None, "backups": []}

    try:
        with _ssh_for_machine(machine) as ssh:
            if req.gus_changes and gus_path:
                gus_ini     = parse_ini(read_remote_file(ssh, gus_path) or "")
                gus_ini     = apply_changes(gus_ini, req.gus_changes)
                new_content = write_ini(gus_ini)
                if req.backup:
                    bp = backup_remote_file(ssh, gus_path)
                    if bp:
                        results["backups"].append(bp)
                ok = write_remote_file(ssh, gus_path, new_content)
                results["gus"] = {"success": ok, "path": gus_path, "size": len(new_content)}

            if req.game_changes and game_path:
                game_ini    = parse_ini(read_remote_file(ssh, game_path) or "")
                game_ini    = apply_changes(game_ini, req.game_changes)
                new_content = write_ini(game_ini)
                if req.backup:
                    bp = backup_remote_file(ssh, game_path)
                    if bp:
                        results["backups"].append(bp)
                ok = write_remote_file(ssh, game_path, new_content)
                results["game"] = {"success": ok, "path": game_path, "size": len(new_content)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SSH error: {exc}")

    return {
        "success":  True,
        "results":  results,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/machines/{machine_id}/containers/{container_name}/config/raw")
async def save_raw_config(machine_id: int, container_name: str, req: SaveRawRequest):
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
            backup_path = backup_remote_file(ssh, file_path) if req.backup else None
            success     = write_remote_file(ssh, file_path, req.content)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SSH error: {exc}")

    if not success:
        raise HTTPException(status_code=500, detail="Write failed.")

    return {
        "success":     True,
        "file":        req.file,
        "path":        file_path,
        "backup_path": backup_path,
        "size":        len(req.content),
    }


@router.post("/machines/{machine_id}/containers/{container_name}/config/stacks")
async def save_stack_overrides(
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
    return await _save_override_list(
        machine_id, container_name,
        "ConfigOverrideItemMaxQuantity", values, req.backup,
    )


@router.post("/machines/{machine_id}/containers/{container_name}/config/crafting")
async def save_crafting_overrides(
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
    return await _save_override_list(
        machine_id, container_name,
        "ConfigOverrideItemCraftingCosts", values, req.backup,
    )


@router.post("/machines/{machine_id}/containers/{container_name}/config/npc-replacements")
async def save_npc_replacements(
    machine_id: int, container_name: str, req: SaveNpcReplacementsRequest,
):
    """Save NPCReplacements entries to Game.ini."""
    values = [
        build_npc_replacement({"from_class": i.from_class, "to_class": i.to_class})
        for i in req.items
    ]
    return await _save_override_list(
        machine_id, container_name, "NPCReplacements", values, req.backup,
    )


@router.post("/machines/{machine_id}/containers/{container_name}/config/override-raw")
async def save_override_raw(
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
    return await _save_override_list(
        machine_id, container_name, req.key, req.values, req.backup,
    )


# ── Shared override helper ─────────────────────────────────────────────────────

async def _save_override_list(
    machine_id:     int,
    container_name: str,
    key:            str,
    values:         list[str],
    backup:         bool,
) -> dict:
    """
    Replace all entries for a repeatable INI key in Game.ini.

    Args:
        machine_id:     Machine primary key.
        container_name: Container directory name.
        key:            INI key to replace (e.g. ``ConfigOverrideItemMaxQuantity``).
        values:         New list of raw value strings.
        backup:         Create a timestamped backup before writing.

    Returns:
        Result dict with success flag, key name, count, and timestamp.
    """
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
            game_ini = parse_ini(read_remote_file(ssh, game_path) or "")
            section  = (
                game_ini.get_section("/script/shootergame.shootergamemode")
                or game_ini.ensure_section("/script/shootergame.shootergamemode")
            )
            section.set_all(key, values)
            new_content = write_ini(game_ini)
            if backup:
                backup_remote_file(ssh, game_path)
            success = write_remote_file(ssh, game_path, new_content)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"SSH error: {exc}")

    return {
        "success":  success,
        "key":      key,
        "count":    len(values),
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
