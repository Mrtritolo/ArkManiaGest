"""
ssh/pok_executor.py -- Execute POK-manager lifecycle actions over SSH and
log the outcome to the ``ARKM_instance_actions`` audit table.

Every ARK server instance lifecycle call (start / stop / restart / update /
backup / delete / rcon) goes through :func:`run_action`, which:

1. Opens a paramiko SSH connection to the instance's machine.
2. Writes a ``pending`` row to ``ARKM_instance_actions``.
3. Executes the command it was handed -- already wrapped for the target
   platform by the caller, via :class:`~app.ssh.platform.PlatformAdapter`
   (WSL on POK/Windows hosts) or emitted as PowerShell by
   :mod:`app.ssh.windows_native` on native hosts.
4. Captures ``(stdout, stderr, exit_code)``.
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
from datetime import datetime
from typing import Any, Callable, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import server_settings
from app.core.store import (
    finalise_action_async,
    log_action_async,
    set_instance_status_async,
)
from app.ssh import windows_native as win
from app.ssh.manager import SSHManager
from app.ssh.platform import PlatformAdapter
from app.ssh.rcon import RconError, rcon_execute


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


# ── Native-Windows command builders ───────────────────────────────────────────

def _native_lifecycle_command(
    action: str,
    instance: dict,
    adapter: PlatformAdapter,
) -> str:
    """
    Build the PowerShell command for a lifecycle *action* on a native host.

    ``restart`` has no dedicated native command: the route layer performs it
    as a graceful stop followed by a start, so that the RCON countdown and
    the world save happen exactly as they do on the POK path.
    """
    base = adapter.native_base_dir()
    service = instance.get("service_name") or win.service_name_for(instance["name"])
    inst_dir = instance.get("instance_dir") or win.instance_dir_for(
        base, instance["name"])

    if action == "start":
        return win.start_cmd(service)
    if action == "stop":
        return win.stop_cmd(service)
    if action == "update":
        return win.update_cmd(base)
    if action == "backup":
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        return win.backup_cmd(
            inst_dir, win.join_win(base, "Backups"), instance["name"], stamp)
    raise ValueError(f"Action {action!r} has no native command builder.")


def _rcon_runner(machine: dict, instance: dict, rcon_cmd: str) -> Callable[[], tuple]:
    """
    Return a callable that runs one RCON command through an SSH tunnel.

    The instance's RCON port is reached at ``127.0.0.1`` *as resolved on the
    host*, so it works identically whether the listener belongs to a Docker
    container publishing the port or to a native Windows process — and it
    never requires the port to be reachable from the panel's network.
    """
    def _run() -> tuple:
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
        channel = None
        try:
            channel = ssh.open_tunnel(int(instance["rcon_port"]))
            out = rcon_execute(
                channel,
                instance.get("admin_password") or "",
                rcon_cmd,
            )
            return (out, "", 0)
        except RconError as exc:
            return ("", str(exc), 1)
        except Exception as exc:
            return ("", f"RCON tunnel failed: {exc}", -1)
        finally:
            if channel is not None:
                try:
                    channel.close()
                except Exception:
                    pass
            ssh.close()

    return _run


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
    runner: Optional[Callable[[], tuple]] = None,
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
        Mutually exclusive with *runner*.
    runner:
        Zero-argument callable returning ``(stdout, stderr, exit_code)``,
        run off the event loop in place of a remote shell command.  Used by
        actions the panel performs itself over the SSH transport rather than
        by spawning a remote process -- RCON is the only one today.
    meta:
        Optional free-form JSON/string to store alongside the action row
        (for example the RCON command text or the update mod list).
    """
    # The command arrives already wrapped for the target platform: every
    # exec_* helper below builds it through the adapter (``pok()`` and
    # ``wrap_shell()`` both wrap) or, on native hosts, emits PowerShell that
    # must not be wrapped at all.  Wrapping again here produced
    # ``wsl.exe -- bash -c 'wsl.exe -- bash -c ...'`` on every Windows/WSL
    # host, which is why nothing worked on that runtime.
    wrapped = command or ""

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
    if runner is not None:
        stdout, stderr, rc = await asyncio.to_thread(runner)
    elif wrapped:
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

    On a machine whose ``runtime`` is ``native`` the same actions are served
    by the PowerShell builders in :mod:`app.ssh.windows_native` instead.
    ``stop`` and ``restart`` first ask the server to save and exit over RCON,
    reproducing the graceful shutdown POK-manager performs inside the
    container; the service stop that follows is only a backstop.
    """
    adapter = PlatformAdapter.from_machine(machine)

    if adapter.is_native:
        if action in ("stop", "restart"):
            await _native_graceful_shutdown(
                db, instance=instance, machine=machine, user=user,
                minutes=restart_minutes,
            )
        if action == "restart":
            stop_result = await run_action(
                db, action="stop", instance=instance, machine=machine, user=user,
                command=_native_lifecycle_command("stop", instance, adapter),
            )
            if stop_result.exit_code != 0:
                return stop_result
            return await run_action(
                db, action="restart", instance=instance, machine=machine, user=user,
                command=_native_lifecycle_command("start", instance, adapter),
            )
        return await run_action(
            db,
            action=action,
            instance=instance,
            machine=machine,
            user=user,
            command=_native_lifecycle_command(action, instance, adapter),
        )

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


# Native restarts with a countdown run detached from the request that asked
# for them, keyed by instance id so a second click cannot stack two
# countdowns on the same server.
_pending_restarts: Dict[int, "asyncio.Task"] = {}

# Marks announced to players, in minutes remaining.  Only those at or below
# the requested countdown are used.
_COUNTDOWN_MARKS = (30, 15, 10, 5, 3, 1)


def native_restart_pending(instance_id: int) -> bool:
    """True while a countdown restart is already scheduled for an instance."""
    task = _pending_restarts.get(instance_id)
    return task is not None and not task.done()


def cancel_native_restart(instance_id: int) -> bool:
    """Cancel a scheduled countdown restart.  Returns True if one was live."""
    task = _pending_restarts.pop(instance_id, None)
    if task is None or task.done():
        return False
    task.cancel()
    return True


async def schedule_native_restart(
    *,
    instance: dict,
    machine: dict,
    user: Optional[dict],
    minutes: int,
) -> None:
    """
    Announce a countdown, then restart -- without holding the HTTP request.

    POK-manager runs its ``-restart <minutes>`` countdown inside the
    container, so the panel's call returns immediately there too.  Natively
    there is nowhere to park the timer but the panel itself, so the work
    moves to a background task with its own DB session: the request's session
    is closed the moment the response is sent.

    Cancelled cleanly on shutdown or by :func:`cancel_native_restart`; a
    cancellation between the announcements and the stop leaves the server
    running, which is the safe outcome.
    """
    async def _run() -> None:
        from app.db import session as db_session

        remaining = max(0, int(minutes))
        marks = [m for m in _COUNTDOWN_MARKS if m <= remaining]

        try:
            for mark in marks:
                await asyncio.sleep(max(0, (remaining - mark)) * 60)
                remaining = mark
                if db_session._async_session is None:
                    return
                async with db_session._async_session() as sess:
                    await exec_rcon(
                        sess, instance=instance, machine=machine, user=user,
                        rcon_cmd=(
                            f"ServerChat Riavvio del server tra {mark} "
                            f"{'minuto' if mark == 1 else 'minuti'}."
                        ),
                    )
            # Burn whatever is left after the last mark.
            await asyncio.sleep(max(0, remaining) * 60)

            if db_session._async_session is None:
                return
            async with db_session._async_session() as sess:
                await exec_pok_lifecycle(
                    sess, action="restart", instance=instance, machine=machine,
                    user=user, restart_minutes=0,
                )
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            # Every step already writes its own audit row; swallowing here
            # keeps a failed announcement from killing the whole restart.
            pass
        finally:
            _pending_restarts.pop(instance["id"], None)

    cancel_native_restart(instance["id"])
    _pending_restarts[instance["id"]] = asyncio.create_task(_run())


async def _native_graceful_shutdown(
    db: AsyncSession,
    *,
    instance: dict,
    machine: dict,
    user: Optional[dict],
    minutes: int,
) -> None:
    """
    Warn players, save the world and ask ARK to exit — before the service stop.

    Docker gives the POK runtime an orderly SIGTERM that POK-manager turns
    into a verified save; a Windows service stop has no equivalent hook, so
    the panel drives the sequence itself.  Every step is best-effort: a
    failure here must not block the stop, or a wedged server could never be
    brought down from the panel.  Each RCON call is logged like any other,
    so the audit trail shows what was attempted.

    Note on *minutes*: this runs at the *end* of a countdown, not instead of
    one.  A restart with a countdown is scheduled by
    :func:`schedule_native_restart`, which announces the marks and only then
    calls back in with ``restart_minutes=0``.  So *minutes* here selects the
    wording of the final warning and nothing else.
    """
    steps = [
        "ServerChat Il server sta per riavviarsi: salvataggio in corso."
        if minutes > 0 else
        "ServerChat Il server sta per spegnersi: salvataggio in corso.",
        "saveworld",
        "DoExit",
    ]

    for step in steps:
        try:
            await exec_rcon(
                db, instance=instance, machine=machine, user=user, rcon_cmd=step,
            )
        except Exception:
            # Deliberately swallowed: see the docstring.  The failed RCON
            # attempt is already recorded in ARKM_instance_actions.
            pass


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

    Native instances have no container, so the probe reads the Windows
    service instead — :func:`app.ssh.windows_native.status_cmd` deliberately
    prints the same three words, which is why the mapping below needs no
    runtime branch.
    """
    adapter = PlatformAdapter.from_machine(machine)
    if adapter.is_native:
        service = (instance.get("service_name")
                   or win.service_name_for(instance["name"]))
        cmd = win.status_cmd(service)
    else:
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
    Forward an RCON command to the instance and log it.

    The panel speaks the Source RCON protocol itself over a ``direct-tcpip``
    channel on the SSH connection (:mod:`app.ssh.rcon`), so this path is the
    same for both runtimes: it needs no ``docker exec``, no host-side RCON
    binary, and the instance's RCON port never has to leave loopback.

    Port and admin password come from the instance row -- the store already
    decrypts ``admin_password_enc``.  Neither ever reaches a command line,
    so nothing sensitive can surface in a process list or an audit row; only
    the command text is recorded, in ``meta``.
    """
    return await run_action(
        db,
        action="rcon",
        instance=instance,
        machine=machine,
        user=user,
        runner=_rcon_runner(machine, instance, rcon_cmd),
        meta=rcon_cmd[:2000],  # keep the audit readable
    )
