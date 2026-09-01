"""
services/native_watchdog.py -- Memory watchdog for native-Windows instances.

On POK hosts ``mem_limit_mb`` is a Docker cgroup: a leaking instance is
OOM-killed on its own and Docker restarts it, and its neighbours never
notice.  Windows offers no equivalent that a service can simply be launched
under, so a native instance that leaks keeps growing until the whole host
starts swapping and every other map on it degrades.

This job closes that gap by measuring instead of constraining: it polls the
resident memory of each running native instance and restarts the ones that
stay over their threshold.

Design constraints that shaped it:

* **Restarting is worse than waiting.**  ARK memory grows normally over a
  wipe cycle and spikes during a world save.  A single sample over the line
  means nothing, so a restart needs ``_BREACHES_BEFORE_ACTION`` *consecutive*
  breaches -- roughly half an hour at the default interval.
* **Never restart the whole host at once.**  A bad threshold applied to
  twelve instances would take the cluster down.  At most one instance is
  restarted per pass, worst offender first.
* **The restart is the ordinary graceful one**, so players get their warning
  and the world is saved before the service stops.
* **Off by default.**  Enabled per install via ``NATIVE_WATCHDOG_ENABLED``;
  when off the loop still runs and still *logs* breaches, so an operator can
  size the thresholds before letting it act.

Started from the FastAPI lifespan alongside the retention job.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Dict, List, Tuple

log = logging.getLogger("arkmaniagest.watchdog")

# How often to sample.  Long enough that the SSH round-trips are negligible,
# short enough that a runaway is caught within an hour.
_POLL_INTERVAL_S = 600

# Consecutive over-threshold samples before a restart is considered.
_BREACHES_BEFORE_ACTION = 3

# A breach only counts above this fraction of the limit, so an instance
# sitting a few MiB over its (advisory) limit is reported but never acted on.
_ACTION_MARGIN = 1.10

# instance_id -> consecutive breach count
_breaches: Dict[int, int] = {}


def _parse_usage(stdout: str) -> Dict[str, int]:
    """Turn ``<service>=<mib>`` lines into a mapping."""
    out: Dict[str, int] = {}
    for line in (stdout or "").splitlines():
        line = line.strip()
        if "=" not in line:
            continue
        name, _, value = line.partition("=")
        try:
            out[name.strip()] = int(float(value.strip()))
        except ValueError:
            continue
    return out


def evaluate(
    usage_mib: Dict[str, int],
    instances: List[dict],
    *,
    breaches: Dict[int, int],
    margin: float = _ACTION_MARGIN,
    threshold_count: int = _BREACHES_BEFORE_ACTION,
) -> Tuple[List[dict], List[dict]]:
    """
    Fold one sample into the breach counters.

    Pure function so the policy is testable without a host.  Returns
    ``(over, actionable)``: everything currently above its limit, and the
    subset that has been above it long enough to justify a restart, worst
    overshoot first.

    Instances that are not in *usage_mib* are not running; their counter is
    cleared so a restart never carries over from a previous life.
    """
    over: List[dict] = []
    actionable: List[dict] = []

    for inst in instances:
        service = inst.get("service_name")
        limit = int(inst.get("mem_limit_mb") or 0)
        if not service or limit <= 0:
            continue
        if service not in usage_mib:
            breaches.pop(inst["id"], None)
            continue

        used = usage_mib[service]
        if used <= limit:
            breaches.pop(inst["id"], None)
            continue

        entry = {**inst, "_used_mib": used, "_limit_mib": limit}
        over.append(entry)

        if used < limit * margin:
            # Over the advisory limit but within the margin: report, do not
            # start counting towards a restart.
            continue

        breaches[inst["id"]] = breaches.get(inst["id"], 0) + 1
        if breaches[inst["id"]] >= threshold_count:
            actionable.append(entry)

    actionable.sort(key=lambda i: i["_used_mib"] - i["_limit_mib"], reverse=True)
    return over, actionable


async def _check_machine(session, machine: dict) -> None:
    """Sample one native host and act on at most one instance."""
    from app.core.store import get_all_instances_async
    from app.ssh import windows_native as win
    from app.ssh.pok_executor import _run_remote_sync, exec_pok_lifecycle
    from app.ssh.platform import PlatformAdapter

    instances = [
        i for i in await get_all_instances_async(
            session, machine_id=machine["id"], active_only=True)
        if i.get("status") == "running"
    ]
    if not instances:
        return

    services = [
        i.get("service_name") or win.service_name_for(i["name"]) for i in instances
    ]
    # Keep the dicts and the services consistent for evaluate().
    for inst, svc in zip(instances, services):
        inst["service_name"] = svc

    adapter = PlatformAdapter.from_machine(machine)
    command = adapter.wrap_shell(win.memory_usage_cmd(services))
    stdout, stderr, rc = await asyncio.to_thread(_run_remote_sync, machine, command)
    if rc != 0:
        log.warning("Watchdog probe failed on %s: %s", machine["name"], stderr)
        return

    usage = _parse_usage(stdout)
    over, actionable = evaluate(usage, instances, breaches=_breaches)

    for entry in over:
        log.warning(
            "Watchdog: %s on %s is at %s MiB against a %s MiB limit (breach %s/%s)",
            entry["name"], machine["name"], entry["_used_mib"], entry["_limit_mib"],
            _breaches.get(entry["id"], 0), _BREACHES_BEFORE_ACTION,
        )

    from app.core.config import server_settings
    if not getattr(server_settings, "NATIVE_WATCHDOG_ENABLED", False):
        return
    if not actionable:
        return

    target = actionable[0]
    log.warning(
        "Watchdog: restarting %s on %s (%s MiB, limit %s MiB)",
        target["name"], machine["name"], target["_used_mib"], target["_limit_mib"],
    )
    _breaches.pop(target["id"], None)
    try:
        await exec_pok_lifecycle(
            session,
            action="restart",
            instance=target,
            machine=machine,
            user=None,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("Watchdog restart of %s failed: %s", target["name"], exc)


async def run_once() -> None:
    """One pass over every active native machine."""
    from app.core.store import get_all_machines_async
    from app.db import session as db_session
    from app.ssh.platform import PlatformAdapter

    if db_session._async_session is None:
        return

    async with db_session._async_session() as session:
        try:
            machines = await get_all_machines_async(session, active_only=True)
        except Exception as exc:  # noqa: BLE001
            log.warning("Watchdog could not list machines: %s", exc)
            return

        for machine in machines:
            if not PlatformAdapter.from_machine(machine).is_native:
                continue
            try:
                await _check_machine(session, machine)
            except Exception as exc:  # noqa: BLE001
                log.warning("Watchdog pass failed on %s: %s", machine["name"], exc)


async def watchdog_loop() -> None:
    """Polling loop; cancelled on application shutdown."""
    while True:
        # Sleep first: at boot the instances have just been polled by the
        # status probe and nothing has had time to leak.
        await asyncio.sleep(_POLL_INTERVAL_S)
        await run_once()
