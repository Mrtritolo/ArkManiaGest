"""
api/routes/machines.py — SSH machine CRUD and connectivity testing.

SSH passwords and passphrases are encrypted with AES-256-GCM before storage.
The raw credential values are never exposed through any read endpoint.
"""
import time
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.config import server_settings
from app.db.session import get_db
from app.core.encryption import encrypt_value
from app.core.store import (
    get_machine_async,
    get_all_machines_async,
    _row_to_machine_dict,
)
from app.schemas.ssh_machine import (
    SSHMachineCreate,
    SSHMachineUpdate,
    SSHMachineRead,
    SSHTestResult,
)
from app.ssh.manager import SSHManager

router = APIRouter()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _machine_to_read(machine: dict) -> SSHMachineRead:
    """
    Convert a decrypted machine dict to the public :class:`SSHMachineRead` schema.

    SSH passwords and passphrases are intentionally excluded.

    Args:
        machine: Decrypted machine dict from the store layer.

    Returns:
        :class:`~app.schemas.ssh_machine.SSHMachineRead` instance.
    """
    return SSHMachineRead(
        id=machine["id"],
        name=machine["name"],
        description=machine.get("description"),
        hostname=machine["hostname"],
        ip_address=machine.get("ip_address"),
        ssh_port=machine.get("ssh_port", 22),
        ssh_user=machine["ssh_user"],
        auth_method=machine.get("auth_method", "password"),
        ssh_key_path=machine.get("ssh_key_path"),
        ark_root_path=machine.get("ark_root_path", "/opt/ark"),
        ark_config_path=machine.get("ark_config_path", ""),
        ark_plugins_path=machine.get("ark_plugins_path", ""),
        os_type=machine.get("os_type") or "linux",
        wsl_distro=machine.get("wsl_distro") or "Ubuntu",
        is_active=machine.get("is_active", True),
        last_connection=machine.get("last_connection"),
        last_status=machine.get("last_status", "unknown"),
        created_at=machine.get("created_at"),
        updated_at=machine.get("updated_at"),
    )


def _ssh_for_machine(machine: dict) -> SSHManager:
    """
    Build an :class:`~app.ssh.manager.SSHManager` from a machine dict.

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


# ── List / read ───────────────────────────────────────────────────────────────

@router.get("", response_model=List[SSHMachineRead])
async def list_machines(
    active_only: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """Return all registered SSH machines, optionally filtered to active ones."""
    machines = await get_all_machines_async(db, active_only=active_only)
    return [_machine_to_read(m) for m in machines]


@router.get("/count")
async def count_machines(db: AsyncSession = Depends(get_db)):
    """
    Return aggregate machine counts for the dashboard.

    Returns:
        Dict with ``total``, ``active``, and ``online`` keys.
    """
    machines = await get_all_machines_async(db)
    return {
        "total":  len(machines),
        "active": sum(1 for m in machines if m.get("is_active", True)),
        "online": sum(1 for m in machines if m.get("last_status") == "online"),
    }


@router.get("/{machine_id}", response_model=SSHMachineRead)
async def get_machine(machine_id: int, db: AsyncSession = Depends(get_db)):
    """Return details for a single SSH machine."""
    machine = await get_machine_async(db, machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found.")
    return _machine_to_read(machine)


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", response_model=SSHMachineRead, status_code=201)
async def create_machine(data: SSHMachineCreate, db: AsyncSession = Depends(get_db)):
    """
    Register a new SSH machine.

    SSH password and passphrase are AES-256-GCM encrypted before being
    written to the ``ssh_password_enc`` / ``ssh_passphrase_enc`` columns.

    Raises:
        HTTPException 409: The machine name is already in use.
    """
    now = datetime.now(timezone.utc)
    raw = data.model_dump()

    ssh_pw_enc = encrypt_value(raw.pop("ssh_password", "") or "") or None
    ssh_pp_enc = encrypt_value(raw.pop("ssh_passphrase", "") or "") or None

    try:
        await db.execute(
            text(
                "INSERT INTO arkmaniagest_machines "
                "(name, description, hostname, ip_address, ssh_port, ssh_user, auth_method, "
                "ssh_password_enc, ssh_key_path, ssh_passphrase_enc, "
                "ark_root_path, ark_config_path, ark_plugins_path, "
                "os_type, wsl_distro, "
                "is_active, last_status, created_at, updated_at) "
                "VALUES (:name, :desc, :host, :ip, :port, :user, :auth, "
                ":pw_enc, :key_path, :pp_enc, "
                ":ark_root, :ark_config, :ark_plugins, "
                ":os_type, :wsl_distro, "
                ":active, 'unknown', :now, :now)"
            ),
            {
                "name":        raw["name"],
                "desc":        raw.get("description"),
                "host":        raw["hostname"],
                "ip":          raw.get("ip_address"),
                "port":        raw.get("ssh_port", 22),
                "user":        raw["ssh_user"],
                "auth":        raw.get("auth_method", "password"),
                "pw_enc":      ssh_pw_enc,
                "key_path":    raw.get("ssh_key_path"),
                "pp_enc":      ssh_pp_enc,
                "ark_root":    raw.get("ark_root_path", "/opt/ark"),
                "ark_config":  raw.get("ark_config_path", ""),
                "ark_plugins": raw.get("ark_plugins_path", ""),
                "os_type":     raw.get("os_type", "linux"),
                "wsl_distro":  raw.get("wsl_distro") or "Ubuntu",
                "active":      1 if raw.get("is_active", True) else 0,
                "now":         now,
            },
        )
    except Exception as exc:
        if "Duplicate" in str(exc):
            raise HTTPException(
                status_code=409,
                detail=f"Machine name '{raw['name']}' is already in use.",
            )
        raise

    result = await db.execute(
        text("SELECT * FROM arkmaniagest_machines WHERE name = :n"),
        {"n": raw["name"]},
    )
    row = result.mappings().fetchone()
    return _machine_to_read(_row_to_machine_dict(dict(row)))


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/{machine_id}", response_model=SSHMachineRead)
async def update_machine(
    machine_id: int,
    data: SSHMachineUpdate,
    db: AsyncSession = Depends(get_db),
):
    """
    Update one or more fields of an existing SSH machine.

    Only provided (non-null) fields are written.  SSH credentials are only
    updated when a non-empty value is supplied; omitting the field preserves
    the existing encrypted value.

    Raises:
        HTTPException 404: Machine not found.
        HTTPException 400: No fields to update.
        HTTPException 409: Machine name collision.
    """
    machine = await get_machine_async(db, machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found.")

    raw = data.model_dump(exclude_unset=True)
    if not raw:
        raise HTTPException(status_code=400, detail="No fields to update.")

    set_clauses: list[str] = []
    params: dict = {"mid": machine_id}

    # Simple columns that do not require encryption
    simple_columns = {
        "name", "description", "hostname", "ip_address", "ssh_port",
        "ssh_user", "auth_method", "ssh_key_path",
        "ark_root_path", "ark_config_path", "ark_plugins_path",
        "os_type", "wsl_distro",
    }
    for field in simple_columns:
        if field in raw and raw[field] is not None:
            set_clauses.append(f"{field} = :{field}")
            params[field] = raw[field]

    if "is_active" in raw:
        set_clauses.append("is_active = :is_active")
        params["is_active"] = 1 if raw["is_active"] else 0

    # Credentials — only encrypt and update when a non-empty value is provided
    if raw.get("ssh_password"):
        set_clauses.append("ssh_password_enc = :pw_enc")
        params["pw_enc"] = encrypt_value(raw["ssh_password"])
    if raw.get("ssh_passphrase"):
        set_clauses.append("ssh_passphrase_enc = :pp_enc")
        params["pp_enc"] = encrypt_value(raw["ssh_passphrase"])

    set_clauses.append("updated_at = :now")
    params["now"] = datetime.now(timezone.utc)

    try:
        await db.execute(
            text(
                f"UPDATE arkmaniagest_machines "
                f"SET {', '.join(set_clauses)} WHERE id = :mid"
            ),
            params,
        )
    except Exception as exc:
        if "Duplicate" in str(exc):
            raise HTTPException(
                status_code=409,
                detail=f"Machine name '{raw.get('name')}' is already in use.",
            )
        raise

    updated = await get_machine_async(db, machine_id)
    return _machine_to_read(updated)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{machine_id}")
async def delete_machine(machine_id: int, db: AsyncSession = Depends(get_db)):
    """Delete an SSH machine record."""
    machine = await get_machine_async(db, machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found.")

    await db.execute(
        text("DELETE FROM arkmaniagest_machines WHERE id = :mid"),
        {"mid": machine_id},
    )
    return {"deleted": True, "id": machine_id, "name": machine["name"]}


# ── Duplicate ─────────────────────────────────────────────────────────────────

@router.post("/{machine_id}/duplicate", response_model=SSHMachineRead, status_code=201)
async def duplicate_machine(machine_id: int, db: AsyncSession = Depends(get_db)):
    """
    Clone an existing SSH machine under a unique derived name.

    The new name is generated by appending " (copy)" or " (copy N)" to the
    source name until a free name is found.
    """
    source = await get_machine_async(db, machine_id)
    if not source:
        raise HTTPException(status_code=404, detail="Machine not found.")

    # Find a unique name derived from the source
    existing_names = {m["name"] for m in await get_all_machines_async(db)}
    counter = 2
    new_name = f"{source['name']} (copy)"
    while new_name in existing_names:
        new_name = f"{source['name']} (copy {counter})"
        counter += 1

    now = datetime.now(timezone.utc)
    ssh_pw_enc = (
        encrypt_value(source.get("ssh_password") or "")
        if source.get("ssh_password") else None
    )
    ssh_pp_enc = (
        encrypt_value(source.get("ssh_passphrase") or "")
        if source.get("ssh_passphrase") else None
    )

    await db.execute(
        text(
            "INSERT INTO arkmaniagest_machines "
            "(name, description, hostname, ip_address, ssh_port, ssh_user, auth_method, "
            "ssh_password_enc, ssh_key_path, ssh_passphrase_enc, "
            "ark_root_path, ark_config_path, ark_plugins_path, "
            "os_type, wsl_distro, "
            "is_active, last_status, created_at, updated_at) "
            "VALUES (:name, :desc, :host, :ip, :port, :user, :auth, "
            ":pw_enc, :key_path, :pp_enc, "
            ":ark_root, :ark_config, :ark_plugins, "
            ":os_type, :wsl_distro, "
            ":active, 'unknown', :now, :now)"
        ),
        {
            "name":        new_name,
            "desc":        source.get("description"),
            "host":        source["hostname"],
            "ip":          source.get("ip_address"),
            "port":        source.get("ssh_port", 22),
            "user":        source["ssh_user"],
            "auth":        source.get("auth_method", "password"),
            "pw_enc":      ssh_pw_enc,
            "key_path":    source.get("ssh_key_path"),
            "pp_enc":      ssh_pp_enc,
            "ark_root":    source.get("ark_root_path", "/opt/ark"),
            "ark_config":  source.get("ark_config_path", ""),
            "ark_plugins": source.get("ark_plugins_path", ""),
            "os_type":     source.get("os_type", "linux"),
            "wsl_distro":  source.get("wsl_distro") or "Ubuntu",
            "active":      1 if source.get("is_active", True) else 0,
            "now":         now,
        },
    )

    result = await db.execute(
        text("SELECT * FROM arkmaniagest_machines WHERE name = :n"),
        {"n": new_name},
    )
    row = result.mappings().fetchone()
    return _machine_to_read(_row_to_machine_dict(dict(row)))


# ── Connection test ───────────────────────────────────────────────────────────

@router.post("/{machine_id}/test", response_model=SSHTestResult)
async def test_machine_connection(
    machine_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Open an SSH connection to the machine and run a trivial command.

    On success the machine's ``last_status`` is set to ``'online'`` and
    ``last_connection`` is updated.  On failure ``last_status`` is set to
    ``'error'``.
    """
    machine = await get_machine_async(db, machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found.")

    start_time = time.time()
    try:
        with _ssh_for_machine(machine) as ssh:
            stdout, _, _ = ssh.execute("echo 'ArkManiaGest OK'")
            elapsed_ms = (time.time() - start_time) * 1_000

            now = datetime.now(timezone.utc)
            await db.execute(
                text(
                    "UPDATE arkmaniagest_machines "
                    "SET last_status = 'online', last_connection = :now "
                    "WHERE id = :mid"
                ),
                {"now": now, "mid": machine_id},
            )
            return SSHTestResult(
                success=True,
                message=f"Connected. Response: {stdout}",
                hostname=machine["hostname"],
                response_time_ms=round(elapsed_ms, 1),
            )

    except Exception as exc:
        await db.execute(
            text(
                "UPDATE arkmaniagest_machines "
                "SET last_status = 'error' WHERE id = :mid"
            ),
            {"mid": machine_id},
        )
        return SSHTestResult(
            success=False,
            message=f"Connection failed: {exc}",
            hostname=machine["hostname"],
        )
