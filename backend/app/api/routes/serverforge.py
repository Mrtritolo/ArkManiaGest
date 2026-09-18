"""
api/routes/serverforge.py — ServerForge API proxy.

All requests to the ServerForge API are routed through the backend so that
the Bearer token is never exposed to the frontend.
The token is read first from the database (set by the GUI) and falls back to
the ``SF_TOKEN`` environment variable.
"""
import asyncio
import httpx
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin, require_operator
from app.core.config import server_settings
from app.core.encryption import decrypt_value, encrypt_value
from app.core.store import get_all_machines_async, get_setting_async, set_setting_async
from app.db.session import get_db
from app.schemas.ssh_machine import AuthMethodEnum

router = APIRouter()

_REQUEST_TIMEOUT = 15.0


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _get_sf_token(db: AsyncSession) -> Optional[str]:
    """
    Return the stored ServerForge token, or ``SF_TOKEN`` from .env when none is.

    A token saved before tokens were encrypted is re-saved encrypted the first
    time it is read, so existing installs stop keeping it in cleartext.
    """
    row = (await db.execute(
        text("SELECT `value`, `encrypted` FROM arkmaniagest_settings WHERE `key` = 'sf_token'")
    )).fetchone()
    if not row or not row[0]:
        return server_settings.SF_TOKEN
    if not row[1]:
        await set_setting_async(db, "sf_token", row[0], encrypted=True)
        return row[0]
    return decrypt_value(row[0]) or server_settings.SF_TOKEN


async def _get_sf_config(db: AsyncSession) -> tuple[str, str]:
    """
    Return the active (token, base_url) pair.

    The DB value always takes precedence over the .env value.

    Returns:
        Tuple of (bearer_token, base_url).

    Raises:
        HTTPException 409: No token is configured anywhere.
    """
    token    = await _get_sf_token(db)
    base_url = (
        await get_setting_async(db, "sf_base_url")
        or server_settings.SF_BASE_URL
        or "https://serverforge.cx/api"
    )
    if not token:
        raise HTTPException(status_code=409, detail="ServerForge token not configured.")
    return token, base_url


def _auth_headers(token: str) -> dict:
    """Build the Authorization header dict for a ServerForge request."""
    return {
        "Authorization": f"Bearer {token}",
        "Accept":        "application/json",
    }


async def _sf_call(config: tuple[str, str], method: str, path: str) -> dict:
    """
    Forward one request to ServerForge and return its JSON body.

    Every upstream failure is a 502, never ServerForge's own status: a 401
    from an expired ServerForge token must not read as the panel session
    expiring, which logs the user out.
    """
    token, base_url = config
    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
            resp = await client.request(
                method, f"{base_url}{path}", headers=_auth_headers(token)
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Cannot reach ServerForge: {exc}")

    if resp.status_code in (401, 403):
        raise HTTPException(
            status_code=502,
            detail=f"ServerForge rejected the API token (HTTP {resp.status_code}).",
        )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"ServerForge returned HTTP {resp.status_code}: {resp.text[:300]}",
        )
    try:
        return resp.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="ServerForge returned a non-JSON response.")


# ── Token configuration ────────────────────────────────────────────────────────

class ServerForgeTokenUpdate(BaseModel):
    """Payload for saving a new ServerForge token."""
    # An empty token would silently switch to SF_TOKEN from .env.
    token:    str = Field(..., min_length=1)
    # The token is sent to this URL: never over plain HTTP.
    base_url: Optional[str] = Field(default=None, pattern=r"^(https://|$)")


@router.get("/config")
async def get_sf_config_status(db: AsyncSession = Depends(get_db)):
    """Return the ServerForge configuration state (token presence only)."""
    token    = await _get_sf_token(db)
    base_url = (
        await get_setting_async(db, "sf_base_url")
        or server_settings.SF_BASE_URL
        or "https://serverforge.cx/api"
    )
    return {"has_token": bool(token), "base_url": base_url}


@router.put("/config", dependencies=[Depends(require_admin)])
async def update_sf_config(
    data: ServerForgeTokenUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Persist a new ServerForge Bearer token (and optionally a custom base URL)."""
    await set_setting_async(
        db, "sf_token", data.token, encrypted=True, description="ServerForge API token",
    )
    if data.base_url:
        await set_setting_async(
            db, "sf_base_url", data.base_url, description="ServerForge base URL",
        )
    return {"success": True, "message": "ServerForge token saved."}


@router.post("/config/test", dependencies=[Depends(require_admin)])
async def test_sf_token(db: AsyncSession = Depends(get_db)):
    """
    Verify the configured token by calling the ``/user/machines`` endpoint.
    """
    token, base_url = await _get_sf_config(db)
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
    # Same limits as SSHMachineCreate: a row GET /machines cannot read back
    # (an unknown auth_method) breaks the machine list for everyone.
    sf_machine_id:   int
    name:            str = Field(..., min_length=1, max_length=100)
    hostname:        str = Field(..., min_length=1, max_length=255)
    ip_address:      Optional[str] = Field(default=None, max_length=45)
    ssh_port:        int = Field(default=22, ge=1, le=65_535)
    ssh_user:        str = Field(..., min_length=1, max_length=64)
    auth_method:     AuthMethodEnum = AuthMethodEnum.PASSWORD
    ssh_password:    Optional[str] = None
    ssh_key_path:    Optional[str] = Field(default=None, max_length=512)
    # Default paths for ServerForge containers (ASA runs under Wine → WindowsServer)
    ark_root_path:   str = Field(default="/gameadmin/containers", max_length=512)
    ark_config_path: str = Field(default="", max_length=512)
    ark_plugins_path:str = Field(default="", max_length=512)


@router.get("/machines/preview-import")
async def preview_import_machines(db: AsyncSession = Depends(get_db)):
    """
    Show ServerForge machines that could be imported, indicating which ones
    are already present in the local database.
    """
    config = await _get_sf_config(db)
    token, base_url = config
    sf_machines = (await _sf_call(config, "GET", "/user/machines")).get("data", [])

    # Compare against locally known machines by hostname and IP
    local_machines = await get_all_machines_async(db)
    local_hosts = {m["hostname"].lower() for m in local_machines if m.get("hostname")}
    local_ips   = {m["ip_address"]       for m in local_machines if m.get("ip_address")}

    async def _ssh_port(client: httpx.AsyncClient, sfm: dict) -> int:
        # The SSH port is only in the detail endpoint, not in the list response
        try:
            dr = await client.get(
                f"{base_url}/machines/{sfm['id']}",
                headers=_auth_headers(token),
            )
            if dr.status_code == 200:
                return dr.json().get("data", {}).get("ssh_port", 22)
        except Exception:
            pass
        return 22

    # One detail call per machine, concurrently: serially, a slow detail
    # endpoint multiplies its timeout by the number of machines.
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as detail_client:
        ssh_ports = await asyncio.gather(
            *[_ssh_port(detail_client, sfm) for sfm in sf_machines]
        )

    result = []
    for sfm, ssh_port in zip(sf_machines, ssh_ports):
        hostname = sfm.get("hostname") or ""
        ip       = sfm.get("ip_address") or ""
        already  = (
            (hostname and hostname.lower() in local_hosts)
            or (ip and ip in local_ips)
        )

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


@router.post("/machines/import", dependencies=[Depends(require_admin)])
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
                "auth":        data.auth_method.value,
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
        # Anything else is a 500 from the global handler, which does not
        # echo the raw database error to the client.
        raise

    # Fetch the newly created row to return its id
    result = await db.execute(
        text("SELECT id FROM arkmaniagest_machines WHERE name = :n"),
        {"n": data.name},
    )
    row = result.fetchone()
    return {"success": True, "machine_id": row[0] if row else None, "name": data.name}


# ── Proxy: machines ────────────────────────────────────────────────────────────

@router.get("/machines")
async def list_machines(db: AsyncSession = Depends(get_db)):
    """Proxy: list all physical machines from ServerForge."""
    return await _sf_call(await _get_sf_config(db), "GET", "/user/machines")


# ── Proxy: containers ─────────────────────────────────────────────────────────

@router.get("/containers")
async def list_containers(db: AsyncSession = Depends(get_db)):
    """Proxy: list all game-server containers from ServerForge."""
    return await _sf_call(await _get_sf_config(db), "GET", "/user/containers")


@router.post("/containers/{container_id}/start", dependencies=[Depends(require_operator)])
async def start_container(container_id: int, db: AsyncSession = Depends(get_db)):
    """Proxy: start a ServerForge container."""
    return await _sf_call(
        await _get_sf_config(db), "POST", f"/containers/{container_id}/start"
    )


@router.post("/containers/{container_id}/stop", dependencies=[Depends(require_operator)])
async def stop_container(container_id: int, db: AsyncSession = Depends(get_db)):
    """Proxy: stop a ServerForge container."""
    return await _sf_call(
        await _get_sf_config(db), "POST", f"/containers/{container_id}/stop"
    )


@router.post("/containers/{container_id}/restart", dependencies=[Depends(require_operator)])
async def restart_container(container_id: int, db: AsyncSession = Depends(get_db)):
    """Proxy: restart a ServerForge container."""
    return await _sf_call(
        await _get_sf_config(db), "POST", f"/containers/{container_id}/restart"
    )


# ── Proxy: clusters ────────────────────────────────────────────────────────────

@router.get("/clusters")
async def list_clusters(db: AsyncSession = Depends(get_db)):
    """Proxy: list all ServerForge clusters."""
    return await _sf_call(await _get_sf_config(db), "GET", "/user/clusters")
