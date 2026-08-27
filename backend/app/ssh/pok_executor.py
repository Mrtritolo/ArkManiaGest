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
import shlex
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

# Countdown, in whole minutes, handed to `-restart`. POK broadcasts it to
# the players in game before the verified save + stop, so 0 would yank the
# server out from under them with no warning.
DEFAULT_RESTART_MINUTES = 1


def _pok_command(
    action: str,
    instance_name: str,
    *,
    extra: str = "",
    restart_minutes: int = DEFAULT_RESTART_MINUTES,
) -> str:
    """
    Build the POK-manager.sh argument string for a lifecycle action.

    Most actions use a ``-flag <instance>`` convention (e.g. ``-start
    MyServer``); ``all`` is a special instance name meaning "every
    configured instance".

    ``-restart`` is the exception: since POK-manager 2.x it takes the
    countdown FIRST -- ``-restart <minutes> <instance>`` -- and 2.1.81
    hard-rejects the old ordering::

        Error: -restart requires a timer in whole minutes before the
        instance name.

    so passing just the instance name (as this builder used to) makes
    every panel restart fail. Verified against ``reference/`` 2.1.81.

    Args:
        action: ``start`` | ``stop`` | ``restart`` | ``update`` | ``backup``.
        instance_name: Name of the POK instance (usually equal to the
                        container name).
        extra: Optional trailing argument (for example ``-clearupdateflag``
               for update, or ``--force`` for stop/restart).
        restart_minutes: Countdown for ``-restart``; ignored otherwise.
    """
    flag = {
        "start":   "-start",
        "stop":    "-stop",
        "restart": "-restart",
        "update":  "-update",
        "backup":  "-backup",
    }[action]
    tail = f" {extra}" if extra else ""
    if action == "restart":
        minutes = max(0, int(restart_minutes))
        return f"{flag} {minutes} {instance_name}{tail}"
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


# Entry point POK-manager exposes inside the container for arbitrary RCON.
# It resolves host/port/password from the container env and shells out to
# rcon-cli itself (scripts/rcon_commands.sh::send_rcon_command, with retries
# and a timeout), so the panel never has to handle credentials here.
_POK_RCON_INTERFACE = "/home/pok/scripts/rcon_interface.sh"


def _rcon_command(
    container_name: str,
    rcon_cmd: str,
    *,
    rcon_port: int | None = None,
    rcon_password: str | None = None,
) -> str:
    """
    Build the ``docker exec`` invocation that runs one RCON command inside
    the instance's container, adapting to whichever ASA image it runs.

    Two images are in the wild and they disagree on everything:

    * **POK-manager** (``acekorneya/asa_server``) installs gorcon as
      ``rcon-cli`` -- not ``rcon`` -- and exposes
      ``scripts/rcon_interface.sh -custom <cmd>``, which resolves
      RCON_HOST/PORT/PASSWORD from the container env and retries on
      failure. Verified against upstream 2.1.81 in ``reference/``.
    * **ASA Manager** (``ghcr.io/asamanager/...``) ships plain gorcon as
      ``rcon`` with no ``rcon.yaml``, so calling it bare dies with
      ``open rcon.yaml: no such file or directory``. It needs explicit
      ``-a host:port -p password``.

    We therefore probe for the POK interface at run time and fall back to
    gorcon with credentials the panel already stores per instance. When no
    credentials are supplied the fallback still runs, so the error the
    operator sees names the real problem instead of a shell 'not found'.

    Neither the RCON command nor the password ever reaches a command line:
    both travel through ``docker exec`` stdin (one line each) so nothing is
    word-split, re-evaluated, or visible in a process list.
    """
    safe_container = shlex.quote(container_name)
    # Reject embedded newlines: the payload is read line-wise below, so a
    # smuggled newline could otherwise inject a second value.
    for field, value in (("command", rcon_cmd), ("password", rcon_password or "")):
        if "\n" in value or "\r" in value:
            raise ValueError(f"RCON {field} must be a single line.")

    interface = shlex.quote(_POK_RCON_INTERFACE)
    addr = f"127.0.0.1:{int(rcon_port)}" if rcon_port else "127.0.0.1:27020"
    safe_addr = shlex.quote(addr)
    # stdin carries password then command, one per line.
    payload = shlex.quote(f"{rcon_password or ''}\n{rcon_cmd}")

    inner = (
        "IFS= read -r RPW; IFS= read -r CMD; "
        f"if [ -x {interface} ]; then {interface} -custom \"$CMD\"; "
        f"else rcon -a {safe_addr} -p \"$RPW\" \"$CMD\"; fi"
    )
    # %s, not %b: the newline separator is already literal inside the
    # quoted payload, and %b would additionally interpret backslash escapes
    # in a password or command that legitimately contains one.
    return (
        f"printf '%s' {payload} | "
        f"docker exec -i {safe_container} bash -lc {shlex.quote(inner)}"
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
    restart_minutes: int = DEFAULT_RESTART_MINUTES,
) -> ActionResult:
    """
    Run one of the POK-manager lifecycle actions (start/stop/restart/update/backup)
    using ``instance["pok_base_dir"]`` as the working directory.

    ``restart_minutes`` is the in-game countdown POK announces before a
    ``restart``; it is ignored by the other actions.
    """
    adapter = PlatformAdapter.from_machine(machine)
    pok_args = _pok_command(
        action, instance["name"], extra=extra, restart_minutes=restart_minutes)
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
    instance row is updated to ``running`` / ``stopped`` / ``missing`` to match;
    ``missing`` means the container no longer exists on the host at all, which
    is distinct from a merely stopped container.
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
    elif docker_state in ("exited", "created"):
        new_status = "stopped"
    elif docker_state == "not-found":
        new_status = "missing"
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
    """
    Forward an RCON command to the instance's container and log it.

    Port and admin password come from the instance row (the store already
    decrypts ``admin_password_enc``); they are only used by the non-POK
    fallback, which needs explicit credentials.
    """
    adapter = PlatformAdapter.from_machine(machine)
    cmd = adapter.wrap_shell(_rcon_command(
        instance["container_name"],
        rcon_cmd,
        rcon_port=instance.get("rcon_port"),
        rcon_password=instance.get("admin_password"),
    ))
    return await run_action(
        db,
        action="rcon",
        instance=instance,
        machine=machine,
        user=user,
        command=cmd,
        meta=rcon_cmd[:2000],  # keep the audit readable
    )
