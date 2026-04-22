"""
api/routes/servers.py -- CRUD and lifecycle management of ARK server instances.

An ARK server instance is a Docker container (managed via POK-manager) that
runs one ARK: Survival Ascended dedicated server on a registered SSH machine.
Every destructive action (start, stop, update, ...) is mirrored into the
``ARKM_instance_actions`` audit table by :mod:`app.ssh.pok_executor`.

Role matrix
-----------
* ``viewer``   : list + detail + status probe
* ``operator`` : start / stop / restart / backup / rcon / create / update
* ``admin``    : delete

The router-level viewer dependency is installed in ``api/routes/__init__.py``;
operator / admin checks are applied per-endpoint here.
"""

from __future__ import annotations

import posixpath
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin, require_operator
from app.core.encryption import encrypt_value
from app.core.store import (
    create_instance_async,
    delete_instance_async,
    get_all_instances_async,
    get_instance_async,
    get_machine_async,
    list_actions_async,
    update_instance_async,
)
from app.db.session import get_db
from app.schemas.instance_action import InstanceActionRead
from app.schemas.server_instance import (
    InstanceStatus,
    ServerInstanceCreate,
    ServerInstanceRead,
    ServerInstanceUpdate,
    UpdateCoordinationRole,
)
from app.ssh.pok_executor import (
    ActionResult,
    exec_pok_lifecycle,
    exec_rcon,
    exec_status_probe,
)
from app.ssh.platform import PlatformAdapter


router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_instance_or_404(db: AsyncSession, instance_id: int) -> dict:
    """Return the instance dict or raise 404."""
    inst = await get_instance_async(db, instance_id)
    if not inst:
        raise HTTPException(status_code=404, detail="Server instance not found.")
    return inst


async def _get_machine_or_404(db: AsyncSession, machine_id: int) -> dict:
    """Return the machine dict or raise 404."""
    machine = await get_machine_async(db, machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found.")
    return machine


def _instance_to_read(inst: dict) -> ServerInstanceRead:
    """Map the decrypted store dict onto the public read schema."""
    return ServerInstanceRead(
        id=inst["id"],
        machine_id=inst["machine_id"],
        name=inst["name"],
        display_name=inst.get("display_name", "") or "",
        description=inst.get("description"),
        map_name=inst.get("map_name", "TheIsland_WP"),
        session_name=inst.get("session_name", ""),
        max_players=inst.get("max_players", 70),
        cluster_id=inst.get("cluster_id"),
        mods=inst.get("mods"),
        passive_mods=inst.get("passive_mods"),
        custom_args=inst.get("custom_args"),
        game_port=inst.get("game_port", 7777),
        rcon_port=inst.get("rcon_port", 27020),
        container_name=inst["container_name"],
        image=inst.get("image", "acekorneya/asa_server:2_1_latest"),
        mem_limit_mb=inst.get("mem_limit_mb", 16_384),
        timezone=inst.get("timezone", "Europe/Rome"),
        pok_base_dir=inst["pok_base_dir"],
        instance_dir=inst["instance_dir"],
        mod_api=bool(inst.get("mod_api", False)),
        battleye=bool(inst.get("battleye", False)),
        update_server=bool(inst.get("update_server", True)),
        update_coordination_role=UpdateCoordinationRole(
            inst.get("update_coordination_role", "FOLLOWER")
        ),
        update_coordination_priority=inst.get("update_coordination_priority", 1),
        cpu_optimization=bool(inst.get("cpu_optimization", False)),
        is_active=bool(inst.get("is_active", True)),
        status=InstanceStatus(inst.get("status", "created")),
        last_status_at=inst.get("last_status_at"),
        last_started_at=inst.get("last_started_at"),
        last_stopped_at=inst.get("last_stopped_at"),
        created_at=inst.get("created_at"),
        updated_at=inst.get("updated_at"),
        has_admin_password=bool(inst.get("has_admin_password")),
        has_server_password=bool(inst.get("has_server_password")),
    )


def _derive_host_paths(
    *,
    machine: dict,
    instance_name: str,
    pok_base_dir_override: Optional[str],
) -> tuple:
    """
    Compute the POK base directory and the per-instance directory.

    If the caller did not pin ``pok_base_dir``, fall back to the machine's
    ``ark_root_path`` (the convention used by the machines page), and then to
    the platform-specific default baked into PlatformAdapter.
    """
    adapter = PlatformAdapter.from_machine(machine)
    base = (
        pok_base_dir_override
        or machine.get("ark_root_path")
        or adapter.default_pok_base_dir()
    ).rstrip("/")
    instance_dir = posixpath.join(base, f"Instance_{instance_name}")
    return base, instance_dir


async def _port_or_name_conflict(
    db: AsyncSession,
    *,
    machine_id: int,
    name: str,
    container_name: str,
    game_port: int,
    rcon_port: int,
    exclude_id: Optional[int] = None,
) -> Optional[str]:
    """
    Return a human-readable conflict message (or None) for port / name clashes
    on the same machine.
    """
    where = "machine_id = :mid"
    params: dict = {"mid": machine_id}
    if exclude_id is not None:
        where += " AND id != :eid"
        params["eid"] = exclude_id
    res = await db.execute(
        text(
            f"SELECT id, name, container_name, game_port, rcon_port "
            f"FROM ARKM_server_instances WHERE {where}"
        ),
        params,
    )
    for row in res.mappings().fetchall():
        if row["name"] == name:
            return f"Instance name '{name}' is already in use on this machine."
        if row["container_name"] == container_name:
            return f"Container name '{container_name}' is already in use on this machine."
        if row["game_port"] == game_port:
            return f"Game port {game_port} is already used by instance '{row['name']}'."
        if row["rcon_port"] == rcon_port:
            return f"RCON port {rcon_port} is already used by instance '{row['name']}'."
    return None


def _action_result_response(inst: dict, result: ActionResult) -> dict:
    """Serialise an :class:`ActionResult` for the HTTP layer."""
    return {
        "instance_id":  inst["id"],
        "action_id":    result.action_id,
        "status":       result.status,
        "exit_code":    result.exit_code,
        "duration_ms":  result.duration_ms,
        "stdout_tail":  (result.stdout or "")[-4000:],
        "stderr_tail":  (result.stderr or "")[-4000:],
    }


# ── List / read ───────────────────────────────────────────────────────────────

@router.get("", response_model=List[ServerInstanceRead])
async def list_instances(
    machine_id: Optional[int] = Query(default=None, ge=1),
    active_only: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """List configured ARK server instances, optionally filtered by machine."""
    rows = await get_all_instances_async(
        db, machine_id=machine_id, active_only=active_only,
    )
    return [_instance_to_read(r) for r in rows]


@router.get("/{instance_id}", response_model=ServerInstanceRead)
async def get_instance(instance_id: int, db: AsyncSession = Depends(get_db)):
    """Return a single ARK server instance."""
    inst = await _get_instance_or_404(db, instance_id)
    return _instance_to_read(inst)


# ── Create ────────────────────────────────────────────────────────────────────

@router.post(
    "",
    response_model=ServerInstanceRead,
    status_code=201,
    dependencies=[Depends(require_operator)],
)
async def create_instance(
    data: ServerInstanceCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new ARK server instance row in the panel DB.

    This does NOT spin up the container on the host -- for that the operator
    must invoke ``POST /servers/{id}/start`` (which in turn calls POK-manager).
    Separating persistence from the host action lets the user fix mistakes in
    the compose spec before anything touches the remote Docker daemon.
    """
    machine = await _get_machine_or_404(db, data.machine_id)
    container_name = f"asa_{data.name.lower()}"
    base_dir, instance_dir = _derive_host_paths(
        machine=machine,
        instance_name=data.name,
        pok_base_dir_override=data.pok_base_dir,
    )

    conflict = await _port_or_name_conflict(
        db,
        machine_id=data.machine_id,
        name=data.name,
        container_name=container_name,
        game_port=data.game_port,
        rcon_port=data.rcon_port,
    )
    if conflict:
        raise HTTPException(status_code=409, detail=conflict)

    admin_pw_enc = encrypt_value(data.admin_password)
    srv_pw_enc = (
        encrypt_value(data.server_password) if data.server_password else None
    )

    now = datetime.now(timezone.utc)
    fields = {
        "machine_id":           data.machine_id,
        "name":                 data.name,
        "display_name":         data.display_name or data.name,
        "description":          data.description,
        "map_name":             data.map_name,
        "session_name":         data.session_name or data.display_name or data.name,
        "max_players":          data.max_players,
        "cluster_id":           data.cluster_id,
        "mods":                 data.mods,
        "passive_mods":         data.passive_mods,
        "custom_args":          data.custom_args,
        "admin_password_enc":   admin_pw_enc,
        "server_password_enc":  srv_pw_enc,
        "game_port":            data.game_port,
        "rcon_port":            data.rcon_port,
        "container_name":       container_name,
        "image":                data.image,
        "mem_limit_mb":         data.mem_limit_mb,
        "timezone":             data.timezone,
        "pok_base_dir":         base_dir,
        "instance_dir":         instance_dir,
        "mod_api":              data.mod_api,
        "battleye":             data.battleye,
        "update_server":        data.update_server,
        "update_coordination_role":     data.update_coordination_role.value,
        "update_coordination_priority": data.update_coordination_priority,
        "cpu_optimization":     data.cpu_optimization,
        "is_active":            True,
        "status":               "created",
        "created_at":           now,
        "updated_at":           now,
    }

    try:
        new_id = await create_instance_async(db, fields)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        if "Duplicate" in str(exc):
            raise HTTPException(
                status_code=409,
                detail="Duplicate instance name or container name on this machine.",
            )
        raise

    created = await _get_instance_or_404(db, new_id)
    return _instance_to_read(created)


# ── Update ────────────────────────────────────────────────────────────────────

@router.put(
    "/{instance_id}",
    response_model=ServerInstanceRead,
    dependencies=[Depends(require_operator)],
)
async def update_instance(
    instance_id: int,
    data: ServerInstanceUpdate,
    db: AsyncSession = Depends(get_db),
):
    """
    Partial update of an instance row.

    The instance *name* and *machine* are intentionally immutable here --
    renaming requires recreating the container, which is a separate workflow.
    """
    inst = await _get_instance_or_404(db, instance_id)
    payload = data.model_dump(exclude_unset=True)

    # Handle password fields separately (encrypt + map onto *_enc columns).
    if "admin_password" in payload:
        pw = payload.pop("admin_password")
        payload["admin_password_enc"] = encrypt_value(pw) if pw else None
    if "server_password" in payload:
        pw = payload.pop("server_password")
        payload["server_password_enc"] = encrypt_value(pw) if pw else None

    # Coerce the coordination role enum back to its string value.
    if "update_coordination_role" in payload and payload["update_coordination_role"]:
        payload["update_coordination_role"] = payload["update_coordination_role"].value

    # Re-check port/name conflicts for whatever the caller changed.
    new_game_port = payload.get("game_port", inst["game_port"])
    new_rcon_port = payload.get("rcon_port", inst["rcon_port"])
    conflict = await _port_or_name_conflict(
        db,
        machine_id=inst["machine_id"],
        name=inst["name"],
        container_name=inst["container_name"],
        game_port=new_game_port,
        rcon_port=new_rcon_port,
        exclude_id=instance_id,
    )
    if conflict:
        raise HTTPException(status_code=409, detail=conflict)

    payload["updated_at"] = datetime.now(timezone.utc)
    await update_instance_async(db, instance_id, payload)
    await db.commit()

    refreshed = await _get_instance_or_404(db, instance_id)
    return _instance_to_read(refreshed)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete(
    "/{instance_id}",
    status_code=204,
    dependencies=[Depends(require_admin)],
)
async def delete_instance_route(
    instance_id: int,
    purge_on_host: bool = Query(
        default=False,
        description=(
            "When true, additionally run POK-manager -stop on the host "
            "before removing the DB row.  The container files on the host "
            "are NEVER deleted by this endpoint; use the Containers page "
            "for that."
        ),
    ),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """
    Remove an instance from the panel DB.

    ``purge_on_host`` is a courtesy hook that issues a POK stop before
    deletion.  Failures are logged in the action table but do not abort the
    DB delete -- otherwise an operator could get stuck unable to remove a
    row pointing at an already-missing machine.
    """
    inst = await _get_instance_or_404(db, instance_id)

    if purge_on_host:
        try:
            machine = await _get_machine_or_404(db, inst["machine_id"])
            await exec_pok_lifecycle(
                db,
                action="stop",
                instance=inst,
                machine=machine,
                user=user,
            )
        except HTTPException:
            # Machine already missing -- delete the row anyway.
            pass
        except Exception:
            # Any SSH / POK error is already in the action log.  Proceed.
            pass

    await delete_instance_async(db, instance_id)
    await db.commit()


# ── Lifecycle actions ─────────────────────────────────────────────────────────
#
# NOTE: Each lifecycle endpoint declares ``user: dict = Depends(require_operator)``
# so the action row gets stamped with the caller.  FastAPI caches the dependency
# per-request, so listing it again in ``dependencies=[]`` is a no-op at runtime.


@router.post("/{instance_id}/start")
async def start_instance(
    instance_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_operator),
):
    """Start the container via POK-manager -start <name>."""
    inst = await _get_instance_or_404(db, instance_id)
    machine = await _get_machine_or_404(db, inst["machine_id"])
    result = await exec_pok_lifecycle(
        db, action="start", instance=inst, machine=machine, user=user,
    )
    return _action_result_response(inst, result)


@router.post("/{instance_id}/stop", dependencies=[Depends(require_operator)])
async def stop_instance(
    instance_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_operator),
):
    """Graceful shutdown via POK-manager -stop <name> (RCON saveworld + exit)."""
    inst = await _get_instance_or_404(db, instance_id)
    machine = await _get_machine_or_404(db, inst["machine_id"])
    result = await exec_pok_lifecycle(
        db, action="stop", instance=inst, machine=machine, user=user,
    )
    return _action_result_response(inst, result)


@router.post("/{instance_id}/restart", dependencies=[Depends(require_operator)])
async def restart_instance(
    instance_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_operator),
):
    """Stop + start in a single POK call."""
    inst = await _get_instance_or_404(db, instance_id)
    machine = await _get_machine_or_404(db, inst["machine_id"])
    result = await exec_pok_lifecycle(
        db, action="restart", instance=inst, machine=machine, user=user,
    )
    return _action_result_response(inst, result)


@router.post("/{instance_id}/update", dependencies=[Depends(require_operator)])
async def update_instance_binary(
    instance_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_operator),
):
    """
    Run POK-manager -update <name> -- pulls the latest ASA build from Steam.

    This call can take 10+ minutes on a slow disk; the HTTP response only
    returns when the remote bash finishes, which is why the panel polls
    ``/actions`` for progress.  Tune ``SSH_TIMEOUT`` in the backend ``.env``
    for very slow hosts.
    """
    inst = await _get_instance_or_404(db, instance_id)
    machine = await _get_machine_or_404(db, inst["machine_id"])
    result = await exec_pok_lifecycle(
        db, action="update", instance=inst, machine=machine, user=user,
    )
    return _action_result_response(inst, result)


@router.post("/{instance_id}/backup", dependencies=[Depends(require_operator)])
async def backup_instance(
    instance_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_operator),
):
    """Trigger POK-manager -backup <name>."""
    inst = await _get_instance_or_404(db, instance_id)
    machine = await _get_machine_or_404(db, inst["machine_id"])
    result = await exec_pok_lifecycle(
        db, action="backup", instance=inst, machine=machine, user=user,
    )
    return _action_result_response(inst, result)


@router.post("/{instance_id}/status")
async def probe_status(
    instance_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_operator),
):
    """
    Refresh the instance ``status`` column by probing ``docker inspect``.

    Viewer role is sufficient because the probe is read-only, but we still
    write an action row so the audit trail is complete.
    """
    inst = await _get_instance_or_404(db, instance_id)
    machine = await _get_machine_or_404(db, inst["machine_id"])
    result = await exec_status_probe(
        db, instance=inst, machine=machine, user=user,
    )
    return _action_result_response(inst, result)


class RconRequest(BaseModel):
    """Body payload for :func:`rcon_instance`."""

    command: str = Field(..., min_length=1, max_length=4000)


@router.post("/{instance_id}/rcon", dependencies=[Depends(require_operator)])
async def rcon_instance(
    instance_id: int,
    data: RconRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_operator),
):
    """
    Forward an RCON command to the running container.

    Multi-line input is rejected because ARK RCON consumes one command per
    line and the audit log is easier to read when each call is a single row.
    """
    if "\n" in data.command or "\r" in data.command:
        raise HTTPException(
            status_code=400,
            detail="RCON commands must be a single line.",
        )
    inst = await _get_instance_or_404(db, instance_id)
    machine = await _get_machine_or_404(db, inst["machine_id"])
    result = await exec_rcon(
        db,
        instance=inst,
        machine=machine,
        user=user,
        rcon_cmd=data.command,
    )
    return _action_result_response(inst, result)


# ── Action log (per-instance convenience) ─────────────────────────────────────

@router.get("/{instance_id}/actions", response_model=List[InstanceActionRead])
async def list_instance_actions(
    instance_id: int,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """List action log entries for a single instance (most recent first)."""
    await _get_instance_or_404(db, instance_id)  # 404 if missing
    rows = await list_actions_async(
        db, instance_id=instance_id, limit=limit, offset=offset,
    )
    return rows
