"""
ssh/pok_executor.py -- Execute POK-manager lifecycle actions over SSH and
log the outcome to the ``ARKM_instance_actions`` audit table.

Every ARK server instance lifecycle call (start / stop / restart / update /
backup / delete / rcon) goes through :func:`run_action`, which:

1. Opens a paramiko SSH connection to the instance's machine.
2. Writes a ``pending`` row to ``ARKM_instance_actions``.
3. Wraps the bash command through :class:`~app.ssh.platform.PlatformAdapter`
   (so Windows hosts transparently go through WSL).
4. Executes the command and captures ``(stdout, stderr, exit_code)``.
5. Finalises the action row with ``success`` / ``failed`` and the captured
   streams; updates the instance ``status`` column when appropriate.
6. Returns an :class:`ActionResult` dict for the HTTP layer.

Long-running actions (POK-manager ``-update`` can take 10+ minutes) rely
on ``SSH_TIMEOUT`` from the panel settings; tweak it in ``.env`` for
slow hosts.  RCON calls are short and finish in milliseconds.

The executor stays synchronous internally (paramiko is blocking) but is
designed to be called from async handlers via ``asyncio.to_thread`` so
FastAPI's event loop never stalls.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import server_settings
from app.core.store import (
    finalise_action_async,
    log_action_async,
    set_instance_status_async,
)
from app.ssh.manager import SSHManager
from app.ssh.platform import PlatformAdapter


# Maps action kinds to the (pre, post_success, post_failure) status a
# running instance should transition through.  ``None`` means "do not
# touch the instance.status column".
#
# We intentionally leave bookkeeping-only actions (rcon, backup, prereqs)
# out of this mapping: they do not change the lifecycle state.
_STATUS_TRANSITIONS: Dict[str, tuple] = {
    "create":  ("created",  "created",  "error"),
    "start":   ("starting", "running",  "error"),
    "stop":    ("stopping", "stopped",  "error"),
    "restart": ("starting", "running",  "error"),
    "update":  ("updating", "stopped",  "error"),
    "delete":  ("stopping", "stopped",  "error"),
}


@dataclass
class ActionResult:
    """Structured return value of :func:`run_action`."""

    action_id: int
    status: str          # "success" | "failed"
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: int


# ── Command builders ──────────────────────────────────────────────────────────

def _pok_command(action: str, instance_name: str, *, extra: str = "") -> str:
    """
    Build the POK-manager.sh argument string for a lifecycle action.

    POK-manager uses a ``-flag <instance>`` convention (e.g. ``-start MyServer``).
    ``all`` is a special instance name meaning "every configured instance".

    Args:
        action: ``start`` | ``stop`` | ``restart`` | ``update`` | ``backup``.
        instance_name: Name of the POK instance (usually equal to the
                        container name).
        extra: Optional trailing argument (for example ``-clearupdateflag``).
    """
    flag = {
        "start":   "-start",
        "stop":    "-stop",
        "restart": "-restart",
        "update":  "-update",
        "backup":  "-backup",
    }[action]
    tail = f" {extra}" if extra else ""
    return f"{flag} {instance_name}{tail}"


def _docker_ps_status_command(container_name: str) -> str:
    """
    Build a lightweight ``docker inspect`` probe that prints the container
    state ("running" / "exited" / "not-found").

    POK-manager calls are cheap but slow because they ``cd`` and start a
    bash script -- for simple status polling we use ``docker inspect``
    directly.
    """
    name = container_name.replace("'", "'\"'\"'")
    return (
        f"docker inspect -f '{{{{.State.Status}}}}' '{name}' "
        f"2>/dev/null || echo 'not-found'"
    )


def _rcon_command(container_name: str, rcon_cmd: str) -> str:
    """
    Build the ``docker exec`` invocation that pipes an RCON command into
    POK-manager's built-in ``rcon`` helper inside the container.

    The caller is responsible for validating / sanitising the RCON string
    (the container is trusted, but multi-line input is rejected upstream).
    """
    safe_container = container_name.replace("'", "'\"'\"'")
    safe_cmd = rcon_cmd.replace("'", "'\"'\"'")
    return (
        f"docker exec '{safe_container}' "
        f"bash -lc 'rcon \"{safe_cmd}\"'"
    )


# ── Public API ────────────────────────────────────────────────────────────────

def _run_remote_sync(machine: dict, command: str) -> tuple:
    """
    Blocking helper: open SSH, run *command*, close.

    Returns ``(stdout, stderr, exit_code)``.  Connection failures surface as
    ``("", <error message>, -1)`` so callers can log them uniformly.
    """
    ssh = SSHManager(
        host=machine["hostname"],
        username=machine["ssh_user"],
        password=machine.get("ssh_password"),
        key_path=machine.get("ssh_key_path"),
        port=machine.get("ssh_port", 22),
        timeout=server_settings.SSH_TIMEOUT,
    )
    try:
        ssh.connect()
    except Exception as exc:  # pragma: no cover - network dependant
        return ("", f"SSH connection failed: {exc}", -1)
    try:
        return ssh.execute(command)
    except Exception as exc:
        return ("", f"Remote exec failed: {exc}", -1)
    finally:
        try:
            ssh.close()
        except Exception:
            pass


async def run_action(
    db: AsyncSession,
    *,
    action: str,
    instance: dict,
    machine: dict,
    user: Optional[dict] = None,
    command: Optional[str] = None,
    meta: Optional[str] = None,
) -> ActionResult:
    """
    Execute a lifecycle action for a single instance and log the outcome.

    Parameters
    ----------
    db:
        Panel DB session.
    action:
        Action kind string -- must match :class:`ActionKind` values
        (``start``, ``stop``, ``restart``, ``update``, ``backup``, ``rcon``,
        ``delete``, ``status``, ``bootstrap``, ``prereqs_check``).
    instance:
        Decrypted ARK server instance dict (as returned by the store).
        May be ``None`` for machine-wide actions such as ``prereqs_check``.
    machine:
        Decrypted SSH machine dict (as returned by the store).
    user:
        JWT payload of the caller (for audit).  Optional.
    command:
        Pre-built bash command string.  Usually built by one of the helpers
        above via the platform adapter; passed through verbatim here.
    meta:
        Optional free-form JSON/string to store alongside the action row
        (for example the RCON command text or the update mod list).
    """
    adapter = PlatformAdapter.from_machine(machine)
    wrapped = adapter.wrap_shell(command) if command else ""

    # 1) Insert a pending action row so the GUI can surface it immediately.
    action_id = await log_action_async(
        db,
        action,
        instance_id=instance["id"] if instance else None,
        machine_id=machine["id"],
        instance_name=(instance["name"] if instance else None),
        status="running",
        user_id=user.get("user_id") if user else None,
        username=user.get("sub") if user else None,
        meta=meta,
    )
    await db.commit()

    # 2) Optional "pre" status transition.
    transitions = _STATUS_TRANSITIONS.get(action)
    if transitions and instance:
        pre_status, _, _ = transitions
        await set_instance_status_async(db, instance["id"], pre_status)
        await db.commit()

    # 3) Run the command off the event loop so we don't block FastAPI.
    started = time.monotonic()
    if wrapped:
        stdout, stderr, rc = await asyncio.to_thread(_run_remote_sync, machine, wrapped)
    else:
        stdout, stderr, rc = ("", "No command provided for this action.", -1)
    duration_ms = int((time.monotonic() - started) * 1000)

    status = "success" if rc == 0 else "failed"

    # 4) Persist the outcome on the action row.
    await finalise_action_async(
        db,
        action_id,
        status=status,
        stdout=stdout,
        stderr=stderr,
        exit_code=rc,
        duration_ms=duration_ms,
    )

    # 5) Lifecycle status bookkeeping on the instance.
    if transitions and instance:
        _, ok_status, fail_status = transitions
        final_status = ok_status if rc == 0 else fail_status
        await set_instance_status_async(
            db,
            instance["id"],
            final_status,
            touch_started=(action in ("start", "restart") and rc == 0),
            touch_stopped=(action in ("stop", "update", "delete") and rc == 0),
        )

    await db.commit()

    return ActionResult(
        action_id=action_id,
        status=status,
        stdout=stdout,
        stderr=stderr,
        exit_code=rc,
        duration_ms=duration_ms,
    )


# ── Shortcuts used by routes/servers.py ───────────────────────────────────────

async def exec_pok_lifecycle(
    db: AsyncSession,
    *,
    action: str,
    instance: dict,
    machine: dict,
    user: Optional[dict] = None,
    extra: str = "",
) -> ActionResult:
    """
    Run one of the POK-manager lifecycle actions (start/stop/restart/update/backup)
    using ``instance["pok_base_dir"]`` as the working directory.
    """
    adapter = PlatformAdapter.from_machine(machine)
    pok_args = _pok_command(action, instance["name"], extra=extra)
    cmd = adapter.pok(pok_args, base_dir=instance["pok_base_dir"])
    return await run_action(
        db,
        action=action,
        instance=instance,
        machine=machine,
        user=user,
        command=cmd,
    )


async def exec_status_probe(
    db: AsyncSession,
    *,
    instance: dict,
    machine: dict,
    user: Optional[dict] = None,
) -> ActionResult:
    """
    Cheap ``docker inspect`` based status check.

    The returned stdout is ``running`` | ``exited`` | ``paused`` | ``not-found``
    (the container state as reported by the Docker daemon).  The ARK server
    instance row is updated to ``running`` / ``stopped`` / ``error`` to match.
    """
    adapter = PlatformAdapter.from_machine(machine)
    cmd = adapter.wrap_shell(_docker_ps_status_command(instance["container_name"]))
    result = await run_action(
        db,
        action="prereqs_check",  # reuse the enum; "status" is not a tracked kind
        instance=instance,
        machine=machine,
        user=user,
        command=cmd,
        meta="status-probe",
    )

    docker_state = (result.stdout or "").strip().lower()
    new_status: Optional[str]
    if docker_state == "running":
        new_status = "running"
    elif docker_state in ("exited", "created", "not-found"):
        new_status = "stopped"
    elif docker_state == "paused":
        new_status = "stopped"
    else:
        new_status = None

    if new_status:
        await set_instance_status_async(db, instance["id"], new_status)
        await db.commit()

    return result


async def exec_rcon(
    db: AsyncSession,
    *,
    instance: dict,
    machine: dict,
    user: Optional[dict] = None,
    rcon_cmd: str,
) -> ActionResult:
    """Forward an RCON command to the instance's container and log it."""
    adapter = PlatformAdapter.from_machine(machine)
    cmd = adapter.wrap_shell(_rcon_command(instance["container_name"], rcon_cmd))
    return await run_action(
        db,
        action="rcon",
        instance=instance,
        machine=machine,
        user=user,
        command=cmd,
        meta=rcon_cmd[:2000],  # keep the audit readable
    )
