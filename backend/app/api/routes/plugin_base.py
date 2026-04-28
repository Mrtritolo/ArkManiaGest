"""
plugin_base.py — Shared infrastructure for SSH-based plugin config editors.

Provides a factory function (:func:`create_plugin_router`) that returns a
FastAPI ``APIRouter`` pre-wired with:

  - Local config CRUD (upload, export, reset, section/list helpers)
  - Pull: download config from a live game server via SSH
  - Deploy: push config to one or all game servers
  - Version history (up to 20 snapshots)
  - License key management

Currently consumed only by ArkShop.  All other ArkMania plugins store their
configuration in the MariaDB database via ``ARKM_config``.
"""
import json
import re
from typing import Optional, List, Callable
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.store import (
    get_containers_map_sync,
    get_machine_sync,
    get_plugin_config_sync,
    save_plugin_config_sync,
    get_setting_sync,
    set_setting_sync,
)
from app.ssh.manager import SSHManager
from app.ssh.scanner import read_remote_file, write_remote_file, backup_remote_file

# Settings key that holds the scanned container map
_CONTAINERS_MAP_KEY = "containers_map"

# Keys that indicate a file is a PluginInfo.json rather than a config
_PLUGININFO_SIGNATURE = frozenset({"FullName", "Description", "MinApiVersion"})
_PLUGININFO_ALL_KEYS  = frozenset({
    "FullName", "Description", "MinApiVersion", "Dependencies",
    "CanBeReloaded", "Author", "URL", "Credits",
})

# File names that should never be treated as plugin configs
_IGNORED_PLUGIN_FILES = frozenset({
    "plugininfo.json", "plugin_info.json",
    "commented.json", "commented_config.json",
    "names.json", "colors.txt", "license.txt",
})


# ── JSON cleaning utilities ───────────────────────────────────────────────────

def _clean_json(text: str) -> str:
    """
    Strip non-standard JSON elements that ARK plugins commonly use:
      - UTF-8 BOM
      - Line comments (``// ...``)
      - Block comments (``/* ... */``)
      - Trailing commas

    Args:
        text: Raw file content.

    Returns:
        JSON string that should be parseable by ``json.loads``.
    """
    # Strip BOM
    text = text.lstrip("\ufeff")
    if text.startswith("\xef\xbb\xbf"):
        text = text[3:]
    text = text.replace("\r", "")

    # Remove line comments, preserving content inside string literals
    lines = []
    for line in text.split("\n"):
        stripped = line.lstrip()
        if stripped.startswith("//"):
            continue
        in_string = False
        result    = []
        i         = 0
        while i < len(line):
            c = line[i]
            if c == '"' and (i == 0 or line[i - 1] != "\\"):
                in_string = not in_string
            if not in_string and c == "/" and i + 1 < len(line) and line[i + 1] == "/":
                break
            result.append(c)
            i += 1
        lines.append("".join(result))

    text = "\n".join(lines)
    # Remove block comments
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    # Remove trailing commas before } or ]
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    return text.strip()


# ── Config inspection utilities ───────────────────────────────────────────────

def _is_plugininfo_content(data: dict) -> bool:
    """Return True if *data* looks like a PluginInfo.json rather than a config."""
    if not isinstance(data, dict):
        return False
    return _PLUGININFO_SIGNATURE.issubset(set(data.keys()))


def _sanitize_config(config: dict) -> dict:
    """Remove PluginInfo-specific keys from a config dict."""
    if not isinstance(config, dict):
        return config
    return {k: v for k, v in config.items() if k not in _PLUGININFO_ALL_KEYS}


# ── Request schemas ────────────────────────────────────────────────────────────

class ConfigUpload(BaseModel):
    config: dict

class SectionUpdate(BaseModel):
    data: dict

class ListUpdate(BaseModel):
    data: list

class SaveVersionRequest(BaseModel):
    label: str


# ── Router factory ─────────────────────────────────────────────────────────────

def create_plugin_router(
    plugin_name:  str,
    versions_key: str,
    folder_names: List[str],
    section_keys: Optional[List[str]] = None,
) -> APIRouter:
    """
    Build a plugin configuration router with standard CRUD + SSH push/pull.

    Args:
        plugin_name:  Identifier used as the settings key prefix (e.g. ``"arkshop"``).
        versions_key: Settings key used to store the version history list.
        folder_names: Plugin folder names to match during container scanning
                      (case-insensitive, e.g. ``["ArkShop", "arkshop"]``).
        section_keys: Optional list of additional section keys to expose.

    Returns:
        A configured :class:`fastapi.APIRouter` with ``router.plugin_helpers``
        attached (a dict of internal callable references used by sub-routers
        like ArkShop to extend the functionality).
    """
    router = APIRouter()

    # ── Private helpers (captured in closure) ─────────────────────────────────

    def _require_vault() -> None:
        """No-op kept for API compatibility (vault replaced by DB)."""
        pass

    def _get_config() -> dict:
        """
        Load and return the current plugin config from the settings DB.

        Raises:
            HTTPException 404: No config has been saved yet.
        """
        config = get_plugin_config_sync(plugin_name)
        if not config:
            raise HTTPException(
                status_code=404,
                detail=f"No {plugin_name} configuration saved.",
            )
        return _sanitize_config(config)

    def _save_config(config: dict) -> None:
        """Persist a sanitised config to the settings DB."""
        save_plugin_config_sync(plugin_name, _sanitize_config(config))

    def _get_ssh(machine: dict) -> SSHManager:
        """Create an SSH manager from a machine dict."""
        return SSHManager(
            host=machine["hostname"],
            username=machine["ssh_user"],
            password=machine.get("ssh_password"),
            key_path=machine.get("ssh_key_path"),
            port=machine.get("ssh_port", 22),
        )

    def _folder_matches(name: str) -> bool:
        """Return True if *name* matches one of the plugin folder names."""
        return name.lower() in [f.lower() for f in folder_names]

    def _find_plugin_containers() -> list[dict]:
        """
        Discover containers that have this plugin installed by consulting the
        scanned container map stored in the settings DB.

        Returns:
            List of dicts with machine and config path information.
        """
        cmap = get_containers_map_sync()
        if not cmap.get("machines"):
            return []

        results = []
        for mid, mdata in cmap.get("machines", {}).items():
            machine = get_machine_sync(int(mid))
            if not machine:
                continue

            for c in mdata.get("containers", []):
                # Find the matching plugin folder name
                actual_folder = next(
                    (p for p in c.get("plugins", []) if _folder_matches(p)),
                    None,
                )
                if not actual_folder:
                    continue

                # Resolve the config.json path
                config_path = None
                for cf in c.get("config_files", []):
                    if cf.get("plugin") == actual_folder:
                        config_path = cf.get("path")
                        break

                if not config_path:
                    for key, path in c.get("paths", {}).items():
                        if key.startswith(f"plugin_{actual_folder.lower()}_"):
                            config_path = path
                            break

                if not config_path:
                    plugins_dir = c.get("paths", {}).get("arkapi_plugins")
                    if plugins_dir:
                        config_path = f"{plugins_dir}/{actual_folder}/config.json"

                # Always normalise to config.json
                if config_path and "/" in config_path:
                    filename = config_path.rsplit("/", 1)[-1].lower()
                    if filename != "config.json":
                        parent      = config_path.rsplit("/", 1)[0]
                        config_path = f"{parent}/config.json"

                if config_path:
                    results.append({
                        "machine_id":    int(mid),
                        "machine_name":  mdata.get("machine_name", machine["hostname"]),
                        "hostname":      machine["hostname"],
                        "container_name":c["name"],
                        "map_name":      c.get("map_name", ""),
                        "server_name":   c.get("server_name", ""),
                        "config_path":   config_path,
                        "plugin_folder": actual_folder,
                    })
        return results

    def _get_versions() -> list[dict]:
        data = get_plugin_config_sync(versions_key)
        return data.get("versions", []) if isinstance(data, dict) else []

    def _save_versions(versions: list[dict]) -> None:
        save_plugin_config_sync(versions_key, {"versions": versions})

    def _is_container_stopped(ssh: SSHManager, container_name: str) -> bool:
        """Return True if no ARK server process is running for the container."""
        stdout, _, _ = ssh.execute(
            f'pgrep -a -f "{container_name}" 2>/dev/null '
            f'| grep -iE "shooter|ark|server" | head -1'
        )
        if stdout.strip():
            return False
        stdout2, _, _ = ssh.execute(
            f'pgrep -a -f "ShooterGame.*{container_name}" 2>/dev/null | head -1'
        )
        return not bool(stdout2.strip())

    # ── Config CRUD ────────────────────────────────────────────────────────────

    @router.get("/config")
    async def get_config():
        """Return the currently saved plugin configuration."""
        _require_vault()
        return _get_config()

    @router.get("/config/status")
    async def config_status():
        """Return whether a config is saved and which sections it contains."""
        _require_vault()
        config = get_plugin_config_sync(plugin_name)
        if not config:
            return {"has_config": False, "sections": []}
        clean    = _sanitize_config(config)
        sections = [k for k in clean if not k.startswith("_")]
        return {"has_config": True, "sections": sections}

    @router.post("/config")
    async def upload_config(data: ConfigUpload):
        """Upload a plugin config JSON directly."""
        _require_vault()
        if _is_plugininfo_content(data.config):
            raise HTTPException(
                status_code=422,
                detail="The uploaded JSON appears to be a PluginInfo.json, not a config.",
            )
        _save_config(data.config)
        clean = _sanitize_config(data.config)
        return {"success": True, "sections": [k for k in clean if not k.startswith("_")]}

    @router.delete("/config")
    async def delete_config():
        """Clear the saved plugin configuration."""
        _require_vault()
        save_plugin_config_sync(plugin_name, {})
        return {"success": True}

    @router.post("/config/reset")
    async def reset_config():
        """Reset the plugin configuration to an empty state."""
        _require_vault()
        save_plugin_config_sync(plugin_name, {})
        return {"success": True, "message": "Configuration reset."}

    @router.get("/config/export")
    async def export_config():
        """Export the current config (internal metadata keys excluded)."""
        _require_vault()
        config = _get_config()
        return {k: v for k, v in config.items() if not k.startswith("_")}

    # ── Generic section endpoints ──────────────────────────────────────────────

    @router.get("/section/{section_name}")
    async def get_section(section_name: str):
        """Return a single config section by name."""
        _require_vault()
        return _get_config().get(section_name, {})

    @router.put("/section/{section_name}")
    async def update_section(section_name: str, data: SectionUpdate):
        """Overwrite a single config section."""
        _require_vault()
        config = _get_config()
        config[section_name] = data.data
        _save_config(config)
        return {"success": True}

    @router.get("/list-section/{section_name}")
    async def get_list_section(section_name: str):
        """Return a list-valued config section."""
        _require_vault()
        return {"items": _get_config().get(section_name, [])}

    @router.put("/list-section/{section_name}")
    async def update_list_section(section_name: str, data: ListUpdate):
        """Overwrite a list-valued config section."""
        _require_vault()
        config = _get_config()
        config[section_name] = data.data
        _save_config(config)
        return {"success": True}

    # ── License ────────────────────────────────────────────────────────────────

    @router.get("/license")
    async def get_license():
        """Return the plugin's license key fields."""
        _require_vault()
        config = _get_config()
        return {
            "AccountKey":       config.get("AccountKey", ""),
            "AutoRenewLicense": config.get("AutoRenewLicense", True),
            "HostLicense":      config.get("HostLicense", False),
        }

    @router.put("/license")
    async def update_license(data: SectionUpdate):
        """Update license key fields."""
        _require_vault()
        config = _get_config()
        for k in ("AccountKey", "AutoRenewLicense", "HostLicense"):
            if k in data.data:
                config[k] = data.data[k]
        _save_config(config)
        return {"success": True}

    # ── Container / server discovery ───────────────────────────────────────────

    @router.get("/servers")
    async def list_servers():
        """List containers where this plugin is installed."""
        _require_vault()
        servers = _find_plugin_containers()
        return {"servers": servers, "total": len(servers)}

    # ── Pull from server ───────────────────────────────────────────────────────

    @router.post("/pull")
    async def pull_config(
        machine_id:     int = Query(...),
        container_name: str = Query(...),
    ):
        """
        Download and cache the plugin config from a live game server.

        Raises:
            HTTPException 404: Container not found in scanned map.
            HTTPException 422: Downloaded file is a PluginInfo.json.
            HTTPException 500: SSH error.
        """
        _require_vault()
        containers = _find_plugin_containers()
        target = next(
            (
                c for c in containers
                if c["machine_id"] == machine_id
                and c["container_name"] == container_name
            ),
            None,
        )
        if not target:
            raise HTTPException(status_code=404, detail="Container not found.")

        machine = get_machine_sync(machine_id)
        if not machine:
            raise HTTPException(status_code=404, detail="Machine not found.")

        try:
            with _get_ssh(machine) as ssh:
                content = read_remote_file(ssh, target["config_path"])
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"SSH error: {exc}")

        if not content:
            raise HTTPException(status_code=404, detail="File not found or empty.")

        try:
            config = json.loads(_clean_json(content))
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid JSON: {exc}")

        if _is_plugininfo_content(config):
            raise HTTPException(
                status_code=422,
                detail="Downloaded file appears to be PluginInfo.json, not config.json.",
            )

        config = _sanitize_config(config)
        config["_source"] = {
            "machine_id":    machine_id,
            "machine_name":  target["machine_name"],
            "container_name":container_name,
            "map_name":      target["map_name"],
            "config_path":   target["config_path"],
            "pulled_at":     datetime.now(timezone.utc).isoformat(),
        }
        _save_config(config)
        return {
            "success":  True,
            "source":   f"{target['machine_name']}/{container_name} ({target['map_name']})",
            "sections": [k for k in config if not k.startswith("_")],
        }

    # ── Deploy to servers ──────────────────────────────────────────────────────

    @router.post("/deploy")
    async def deploy_config(
        version_id:     Optional[int] = Query(None),
        machine_id:     Optional[int] = Query(None),
        container_name: Optional[str] = Query(None),
        force:          bool          = Query(False),
    ):
        """
        Push the current (or a specific version) config to game servers.

        Servers that are currently running are skipped unless ``force=True``.

        Args:
            version_id:     Deploy a saved version instead of the current config.
            machine_id:     Restrict deployment to a specific machine.
            container_name: Restrict deployment to a specific container.
            force:          Deploy even if the container appears to be running.
        """
        _require_vault()

        if version_id is not None:
            versions = _get_versions()
            target_version = next((v for v in versions if v["id"] == version_id), None)
            if not target_version:
                raise HTTPException(status_code=404, detail="Version not found.")
            deploy_data  = target_version["config"]
            deploy_label = f"v{version_id} - {target_version['label']}"
        else:
            config       = _get_config()
            deploy_data  = {k: v for k, v in config.items() if not k.startswith("_")}
            deploy_label = "current config"

        config_json = json.dumps(deploy_data, indent=2, ensure_ascii=False)
        containers  = _find_plugin_containers()

        if machine_id is not None and container_name:
            containers = [
                c for c in containers
                if c["machine_id"] == machine_id and c["container_name"] == container_name
            ]
        elif machine_id is not None:
            containers = [c for c in containers if c["machine_id"] == machine_id]

        if not containers:
            raise HTTPException(status_code=404, detail="No target containers found.")

        # Group by machine to minimise SSH connections
        by_machine: dict[int, list] = {}
        for c in containers:
            by_machine.setdefault(c["machine_id"], []).append(c)

        results = []
        for mid, targets in by_machine.items():
            machine = get_machine_sync(mid)
            if not machine:
                for t in targets:
                    results.append(_deploy_result(t, False, "Machine not found", "error"))
                continue

            try:
                with _get_ssh(machine) as ssh:
                    for t in targets:
                        if not _is_container_stopped(ssh, t["container_name"]) and not force:
                            results.append(
                                _deploy_result(
                                    t, False,
                                    "Container is running. Stop it first.",
                                    "running",
                                )
                            )
                            continue
                        try:
                            bak = backup_remote_file(ssh, t["config_path"])
                            ok  = write_remote_file(ssh, t["config_path"], config_json)
                            results.append(
                                _deploy_result(
                                    t, ok,
                                    f"Deployed ({deploy_label})" if ok else "Write failed",
                                    "deployed" if ok else "error",
                                    backup_path=bak,
                                )
                            )
                        except Exception as exc:
                            results.append(_deploy_result(t, False, str(exc), "error"))
            except Exception as exc:
                for t in targets:
                    results.append(_deploy_result(t, False, f"SSH: {exc}", "error"))

        deployed = sum(1 for r in results if r["success"])
        skipped  = sum(1 for r in results if r["status"] == "running")
        failed   = sum(1 for r in results if r["status"] == "error")
        return {
            "success":         failed == 0 and skipped == 0,
            "version":         deploy_label,
            "total":           len(results),
            "deployed":        deployed,
            "skipped_running": skipped,
            "failed":          failed,
            "results":         results,
        }

    def _deploy_result(
        target: dict,
        success: bool,
        message: str,
        status: str,
        backup_path: Optional[str] = None,
    ) -> dict:
        """Build a deployment result entry for a single container."""
        return {
            "container":   target["container_name"],
            "machine":     target["machine_name"],
            "map_name":    target["map_name"],
            "success":     success,
            "message":     message,
            "status":      status,
            "backup_path": backup_path,
        }

    # ── Version history ────────────────────────────────────────────────────────

    @router.get("/versions")
    async def list_versions():
        """Return the saved version list (metadata only, no full config)."""
        _require_vault()
        versions = _get_versions()
        return {
            "versions": [
                {
                    "id":         v["id"],
                    "label":      v["label"],
                    "created_at": v["created_at"],
                    "sections":   len(v.get("config", {}).keys()),
                    "source":     v.get("source"),
                }
                for v in versions
            ],
            "total": len(versions),
        }

    @router.post("/versions")
    async def save_version(req: SaveVersionRequest):
        """Snapshot the current config as a named version."""
        _require_vault()
        config = _get_config()
        clean  = {k: v for k, v in config.items() if not k.startswith("_")}

        versions = _get_versions()
        new_id   = max((v["id"] for v in versions), default=0) + 1
        versions.insert(0, {
            "id":         new_id,
            "label":      req.label.strip(),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "config":     clean,
            "source":     config.get("_source", {}).get("container_name", "manual"),
        })
        # Retain at most 20 versions
        if len(versions) > 20:
            versions = versions[:20]
        _save_versions(versions)
        return {
            "success":        True,
            "version_id":     new_id,
            "label":          req.label.strip(),
            "total_versions": len(versions),
        }

    @router.post("/versions/{version_id}/restore")
    async def restore_version(version_id: int):
        """Restore a saved version as the current config."""
        _require_vault()
        target = next((v for v in _get_versions() if v["id"] == version_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Version not found.")
        config = _sanitize_config(dict(target["config"]))
        config["_source"] = {
            "restored_from": f"v{version_id} - {target['label']}",
            "restored_at":   datetime.now(timezone.utc).isoformat(),
        }
        _save_config(config)
        return {"success": True, "version_id": version_id, "label": target["label"]}

    @router.delete("/versions/{version_id}")
    async def delete_version(version_id: int):
        """Delete a saved version."""
        _require_vault()
        versions     = _get_versions()
        new_versions = [v for v in versions if v["id"] != version_id]
        if len(new_versions) == len(versions):
            raise HTTPException(status_code=404, detail="Version not found.")
        _save_versions(new_versions)
        return {"success": True}

    # Attach helpers for sub-routers that extend this router (e.g. arkshop.py)
    router.plugin_helpers = {
        "require_vault":    _require_vault,
        "get_config":       _get_config,
        "save_config":      _save_config,
        "get_ssh":          _get_ssh,
        "find_containers":  _find_plugin_containers,
        "clean_json":       _clean_json,
        "sanitize_config":  _sanitize_config,
        "get_versions":     _get_versions,
        "save_versions":    _save_versions,
        "check_stopped":    _is_container_stopped,
    }

    return router
