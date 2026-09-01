"""
api/routes/cluster_sync.py -- Cluster directory health across the machines.

ARK cluster transfers are files on disk (see :mod:`app.ssh.cluster_sync`), so
a multi-host cluster only works while every host sees the same directory.
When the replication behind that breaks, nothing errors: uploads keep
"succeeding" on the origin and simply never arrive.  This router probes every
host that owns instances in a cluster and reports whether they agree.

The panel does not perform the replication itself -- Syncthing, DFS-R or an
SMB share do -- so these endpoints are strictly read-only diagnostics.
"""

from __future__ import annotations

import asyncio
import time
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import server_settings
from app.core.store import get_all_instances_async, get_all_machines_async
from app.db.session import get_db
from app.schemas.cluster_sync import (
    ClusterHealthRead,
    ClusterMemberRead,
    SyncthingRead,
)
from app.ssh import cluster_sync as sync_lib
from app.ssh.manager import SSHManager
from app.ssh.platform import PlatformAdapter

router = APIRouter()


def _probe_machine_sync(machine: dict, command: str) -> str:
    """
    Blocking probe of one host.  Errors come back as text, never as raises:
    a single unreachable host must degrade its own row, not the whole page.
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
        return f"error=SSH connection failed: {exc}"
    try:
        stdout, stderr, rc = ssh.execute(command)
        if rc != 0 and not stdout:
            return f"error={stderr or 'probe exited ' + str(rc)}"
        return stdout
    except Exception as exc:
        return f"error=Remote exec failed: {exc}"
    finally:
        ssh.close()


@router.get("", response_model=List[ClusterHealthRead])
async def cluster_health(db: AsyncSession = Depends(get_db)):
    """
    Report cluster-directory agreement for every cluster the panel knows.

    Instances are grouped by ``cluster_id``; each distinct machine hosting
    one of them is probed once, in parallel.  A cluster whose instances all
    live on a single host reports ``unknown`` -- there is nothing to compare,
    and that is not a fault.
    """
    machines = {m["id"]: m for m in await get_all_machines_async(db)}
    instances = await get_all_instances_async(db, active_only=True)

    # cluster_id -> set of machine ids hosting it
    clusters: Dict[str, set] = {}
    for inst in instances:
        cid = (inst.get("cluster_id") or "").strip()
        if cid:
            clusters.setdefault(cid, set()).add(inst["machine_id"])

    if not clusters:
        return []

    # Build the full probe list first so every host is hit once per cluster,
    # concurrently, instead of serially per cluster.
    jobs: List[tuple] = []
    for cid, machine_ids in clusters.items():
        for mid in sorted(machine_ids):
            machine = machines.get(mid)
            if not machine:
                continue
            adapter = PlatformAdapter.from_machine(machine)
            cluster_dir = machine.get("cluster_dir")
            if not cluster_dir:
                # Nothing configured: report it rather than guessing a path.
                jobs.append((cid, machine, adapter, None, None))
                continue
            jobs.append((
                cid, machine, adapter, cluster_dir,
                sync_lib.probe_cmd(cluster_dir, cid, adapter),
            ))

    results = await asyncio.gather(*[
        asyncio.to_thread(_probe_machine_sync, machine, cmd)
        if cmd else asyncio.sleep(0, result="error=cluster_dir not configured")
        for _cid, machine, _adapter, _dir, cmd in jobs
    ])

    # Syncthing identity is per machine, not per cluster: probe each host once
    # even when it carries instances from several clusters.
    seen: Dict[int, dict] = {}
    for _cid, machine, adapter, _dir, _cmd in jobs:
        seen.setdefault(machine["id"], {"machine": machine, "adapter": adapter})
    sync_ids = list(seen.keys())
    sync_out = await asyncio.gather(*[
        asyncio.to_thread(
            _probe_machine_sync,
            seen[mid]["machine"],
            sync_lib.syncthing_probe_cmd(seen[mid]["adapter"]),
        )
        for mid in sync_ids
    ])
    sync_raw: Dict[int, str] = dict(zip(sync_ids, sync_out))

    now = int(time.time())
    grouped: Dict[str, List] = {}
    for (cid, machine, adapter, cluster_dir, _cmd), stdout in zip(jobs, results):
        path = (
            sync_lib.effective_cluster_path(cluster_dir, cid, native=adapter.is_native)
            if cluster_dir else ""
        )
        if stdout.startswith("error="):
            fp = sync_lib.ClusterFingerprint(
                machine_id=machine["id"], machine_name=machine["name"],
                path=path, error=stdout[len("error="):],
            )
        else:
            fp = sync_lib.parse_probe(
                stdout, machine_id=machine["id"],
                machine_name=machine["name"], path=path,
            )
        grouped.setdefault(cid, []).append((fp, sync_raw.get(machine["id"], "")))

    out: List[ClusterHealthRead] = []
    for cid, pairs in sorted(grouped.items()):
        fps = [fp for fp, _raw in pairs]
        sync_by_machine = {
            fp.machine_id: sync_lib.parse_syncthing(raw, fp.path)
            for fp, raw in pairs
        }
        verdict = sync_lib.compare(cid, fps, now_epoch=now)
        out.append(ClusterHealthRead(
            cluster_id=cid,
            status=verdict.status,
            detail=verdict.detail,
            members=[
                ClusterMemberRead(
                    machine_id=f.machine_id,
                    machine_name=f.machine_name,
                    path=f.path,
                    exists=f.exists,
                    file_count=f.file_count,
                    total_bytes=f.total_bytes,
                    newest_epoch=f.newest_epoch,
                    digest=f.digest,
                    error=f.error,
                    syncthing=(
                        SyncthingRead(
                            present=sync_by_machine[f.machine_id].present,
                            device_id=sync_by_machine[f.machine_id].device_id,
                            folders=sync_by_machine[f.machine_id].folders,
                            covers_cluster_dir=(
                                sync_by_machine[f.machine_id].covers_cluster_dir
                            ),
                        )
                        if f.machine_id in sync_by_machine else None
                    ),
                )
                for f in sorted(fps, key=lambda x: x.machine_name)
            ],
        ))
    return out


@router.get("/{cluster_id}", response_model=ClusterHealthRead)
async def cluster_health_one(cluster_id: str, db: AsyncSession = Depends(get_db)):
    """Same report, narrowed to a single cluster."""
    for item in await cluster_health(db):
        if item.cluster_id == cluster_id:
            return item
    raise HTTPException(status_code=404, detail="Unknown cluster id.")
