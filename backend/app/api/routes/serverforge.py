"""
api/routes/serverforge.py — ServerForge API proxy.

All requests to the ServerForge API are routed through the backend so that
the Bearer token is never exposed to the frontend.
The token is read first from the database (set by the GUI) and falls back to
the ``SF_TOKEN`` environment variable.
"""
import httpx
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import server_settings
from app.core.encryption import encrypt_value
from app.core.store import get_all_machines_sync, get_setting_sync, set_setting_sync
from app.db.session import get_db

router = APIRouter()

_REQUEST_TIMEOUT = 15.0


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_sf_config() -> tuple[str, str]:
    """
    Return the active (token, base_url) pair.

    The DB value always takes precedence over the .env value.

    Returns:
        Tuple of (bearer_token, base_url).

    Raises:
        HTTPException 400: No token is configured anywhere.
    """
    token    = get_setting_sync("sf_token")    or server_settings.SF_TOKEN
    base_url = (
        get_setting_sync("sf_base_url")
        or server_settings.SF_BASE_URL
        or "https://serverforge.cx/api"
    )
    if not token:
        raise HTTPException(status_code=400, detail="ServerForge token not configured.")
    return token, base_url


def _auth_headers(token: str) -> dict:
    """Build the Authorization header dict for a ServerForge request."""
    return {
        "Authorization": f"Bearer {token}",
        "Accept":        "application/json",
    }


# ── Token configuration ────────────────────────────────────────────────────────

class ServerForgeTokenUpdate(BaseModel):
    """Payload for saving a new ServerForge token."""
    token:    str
    base_url: Optional[str] = None


@router.get("/config")
async def get_sf_config_status():
    """Return the ServerForge configuration state (token presence only)."""
    token    = get_setting_sync("sf_token")    or server_settings.SF_TOKEN
    base_url = (
        get_setting_sync("sf_base_url")
        or server_settings.SF_BASE_URL
        or "https://serverforge.cx/api"
    )
    return {"has_token": bool(token), "base_url": base_url}


@router.put("/config")
async def update_sf_config(data: ServerForgeTokenUpdate):
    """Persist a new ServerForge Bearer token (and optionally a custom base URL)."""
    set_setting_sync("sf_token", data.token, description="ServerForge API token")
    if data.base_url:
        set_setting_sync("sf_base_url", data.base_url, description="ServerForge base URL")
    return {"success": True, "message": "ServerForge token saved."}


@router.post("/config/test")
async def test_sf_token():
    """
    Verify the configured token by calling the ``/user/machines`` endpoint.
    """
    token, base_url = _get_sf_config()
    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
            resp = await client.get(
                f"{base_url}/user/machines", headers=_auth_headers(token)
            )
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "success": True,
                    "message": f"Token valid. {data.get('total_count', 0)} machines found.",
                }
            elif resp.status_code == 401:
                return {"success": False, "message": "Token invalid or expired."}
            else:
                return {
                    "success": False,
                    "message": f"Error {resp.status_code}: {resp.text[:200]}",
                }
    except httpx.ConnectError:
        return {"success": False, "message": "Cannot reach ServerForge."}
    except Exception as exc:
        return {"success": False, "message": f"Error: {exc}"}


# ── Machine import ─────────────────────────────────────────────────────────────

class SFImportMachineRequest(BaseModel):
    """Fields required to import a ServerForge machine into the local database."""
    sf_machine_id:   int
    name:            str
    hostname:        str
    ip_address:      Optional[str] = None
    ssh_port:        int = 22
    ssh_user:        str
    auth_method:     str = "password"
    ssh_password:    Optional[str] = None
    ssh_key_path:    Optional[str] = None
    # Default paths for ServerForge containers (ASA runs under Wine → WindowsServer)
    ark_root_path:   str = "/gameadmin/containers"
    ark_config_path: str = ""
    ark_plugins_path:str = ""


@router.get("/machines/preview-import")
async def preview_import_machines():
    """
    Show ServerForge machines that could be imported, indicating which ones
    are already present in the local database.
    """
    token, base_url = _get_sf_config()

    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
        resp = await client.get(
            f"{base_url}/user/machines", headers=_auth_headers(token)
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])

    sf_machines = resp.json().get("data", [])

    # Compare against locally known machines by hostname and IP
    local_machines = get_all_machines_sync()
    local_hosts = {m["hostname"].lower() for m in local_machines if m.get("hostname")}
    local_ips   = {m["ip_address"]       for m in local_machines if m.get("ip_address")}

    result = []
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as detail_client:
        for sfm in sf_machines:
            hostname = sfm.get("hostname") or ""
            ip       = sfm.get("ip_address") or ""
            already  = (
                (hostname and hostname.lower() in local_hosts)
                or (ip and ip in local_ips)
            )

            # Fetch the SSH port from the detail endpoint (not in the list response)
            ssh_port = 22
            try:
                dr = await detail_client.get(
                    f"{base_url}/machines/{sfm['id']}",
                    headers=_auth_headers(token),
                )
                if dr.status_code == 200:
                    ssh_port = dr.json().get("data", {}).get("ssh_port", 22)
            except Exception:
                pass

            result.append({
                "sf_id":            sfm.get("id"),
                "hostname":         hostname,
                "ip_address":       ip,
                "status":           sfm.get("status", "unknown"),
                "os":               sfm.get("os", ""),
                "location":         sfm.get("location", ""),
                "ssh_port":         ssh_port,
                "containers_count": sfm.get("containers_count", 0),
                "clusters_count":   sfm.get("clusters_count", 0),
                "already_imported": already,
            })

    return {"machines": result, "total": len(result)}


@router.post("/machines/import")
async def import_machine(
    data: SFImportMachineRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Import a ServerForge machine into the local database.

    SSH credentials must be supplied manually because the ServerForge API
    does not expose them.  Uses the async SQLAlchemy session so the operation
    participates in the standard transaction lifecycle (committed by get_db).

    Raises:
        HTTPException 409: Machine name already in use.
        HTTPException 500: Database insertion failed.
    """
    now        = datetime.now(timezone.utc)
    ssh_pw_enc = encrypt_value(data.ssh_password) if data.ssh_password else None

    try:
        await db.execute(
            text(
                "INSERT INTO arkmaniagest_machines "
                "(name, description, hostname, ip_address, ssh_port, ssh_user, "
                "auth_method, ssh_password_enc, ssh_key_path, "
                "ark_root_path, ark_config_path, ark_plugins_path, "
                "is_active, last_status, created_at, updated_at) "
                "VALUES (:name, :desc, :host, :ip, :port, :user, "
                ":auth, :pw_enc, :key_path, "
                ":ark_root, :ark_config, :ark_plugins, "
                "1, 'unknown', :now, :now)"
            ),
            {
                "name":        data.name,
                "desc":        f"Imported from ServerForge (ID: {data.sf_machine_id})",
                "host":        data.hostname,
                "ip":          data.ip_address,
                "port":        data.ssh_port,
                "user":        data.ssh_user,
                "auth":        data.auth_method,
                "pw_enc":      ssh_pw_enc,
                "key_path":    data.ssh_key_path,
                "ark_root":    data.ark_root_path,
                "ark_config":  data.ark_config_path,
                "ark_plugins": data.ark_plugins_path,
                "now":         now,
            },
        )
    except Exception as exc:
        if "Duplicate" in str(exc):
            raise HTTPException(
                status_code=409,
                detail=f"Name '{data.name}' is already in use.",
            )
        raise HTTPException(status_code=500, detail=str(exc))

    # Fetch the newly created row to return its id
    result = await db.execute(
        text("SELECT id FROM arkmaniagest_machines WHERE name = :n"),
        {"n": data.name},
    )
    row = result.fetchone()
    return {"success": True, "machine_id": row[0] if row else None, "name": data.name}


# ── Proxy: machines ────────────────────────────────────────────────────────────

@router.get("/machines")
async def list_machines():
    """Proxy: list all physical machines from ServerForge."""
    token, base_url = _get_sf_config()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
        resp = await client.get(f"{base_url}/user/machines", headers=_auth_headers(token))
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
        return resp.json()


@router.get("/machines/{machine_id}")
async def get_machine(machine_id: int):
    """Proxy: detail for a single ServerForge machine."""
    token, base_url = _get_sf_config()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
        resp = await client.get(
            f"{base_url}/machines/{machine_id}", headers=_auth_headers(token)
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
        return resp.json()


# ── Proxy: containers ─────────────────────────────────────────────────────────

@router.get("/containers")
async def list_containers():
    """Proxy: list all game-server containers from ServerForge."""
    token, base_url = _get_sf_config()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
        resp = await client.get(
            f"{base_url}/user/containers", headers=_auth_headers(token)
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
        return resp.json()


@router.get("/containers/{container_id}")
async def get_container(container_id: int):
    """Proxy: detail for a single ServerForge container."""
    token, base_url = _get_sf_config()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
        resp = await client.get(
            f"{base_url}/containers/{container_id}", headers=_auth_headers(token)
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
        return resp.json()


@router.get("/containers/{container_id}/status")
async def get_container_status(container_id: int):
    """Proxy: quick status for a ServerForge container."""
    token, base_url = _get_sf_config()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
        resp = await client.get(
            f"{base_url}/containers/{container_id}/status",
            headers=_auth_headers(token),
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
        return resp.json()


@router.post("/containers/{container_id}/start")
async def start_container(container_id: int):
    """Proxy: start a ServerForge container."""
    token, base_url = _get_sf_config()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
        resp = await client.post(
            f"{base_url}/containers/{container_id}/start",
            headers=_auth_headers(token),
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
        return resp.json()


@router.post("/containers/{container_id}/stop")
async def stop_container(container_id: int):
    """Proxy: stop a ServerForge container."""
    token, base_url = _get_sf_config()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
        resp = await client.post(
            f"{base_url}/containers/{container_id}/stop",
            headers=_auth_headers(token),
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
        return resp.json()


@router.post("/containers/{container_id}/restart")
async def restart_container(container_id: int):
    """Proxy: restart a ServerForge container."""
    token, base_url = _get_sf_config()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
        resp = await client.post(
            f"{base_url}/containers/{container_id}/restart",
            headers=_auth_headers(token),
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
        return resp.json()


# ── Proxy: clusters ────────────────────────────────────────────────────────────

@router.get("/clusters")
async def list_clusters():
    """Proxy: list all ServerForge clusters."""
    token, base_url = _get_sf_config()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
        resp = await client.get(f"{base_url}/user/clusters", headers=_auth_headers(token))
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
        return resp.json()


@router.get("/clusters/{cluster_id}")
async def get_cluster(cluster_id: int):
    """Proxy: detail for a single ServerForge cluster."""
    token, base_url = _get_sf_config()
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
        resp = await client.get(
            f"{base_url}/clusters/{cluster_id}", headers=_auth_headers(token)
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
        return resp.json()
