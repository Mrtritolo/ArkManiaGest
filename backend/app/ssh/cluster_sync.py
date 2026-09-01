"""
ssh/cluster_sync.py -- Health probe for the ARK cluster directory.

ARK implements cluster transfers as files: uploading a survivor, a dino or a
pile of items writes a blob named after the player's EOS id into the cluster
directory, and the destination map reads it back.  That only works if every
map in the cluster sees the same directory, so a multi-host cluster needs the
directory replicated (Syncthing, DFS-R) or centralised (an SMB share).

The panel deliberately does **not** perform the replication -- purpose-built
tools do it better.  What the panel does is notice when it has stopped
working, which is otherwise invisible: transfers keep "succeeding" on the
origin and silently never arrive.  :func:`probe_cmd` collects a fingerprint
of the directory per host and :func:`compare` turns the fingerprints into a
verdict.

Path layout
-----------

``-ClusterDirOverride`` names a *root*; ARK appends ``clusters/<ClusterID>/``
to it.  So a host launched with ``-ClusterDirOverride=/cluster`` and
``-ClusterID=ArkManiaV2`` writes to ``/cluster/clusters/ArkManiaV2/``.  Point
the machine's ``cluster_dir`` at the root, not at the leaf: aiming a
replication tool one level off is an easy mistake that leaves a plausible
looking but permanently stale directory behind.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional

from app.ssh.platform import PlatformAdapter
from app.ssh.windows_native import join_win, ps_quote

# A cluster directory whose newest file is older than this is reported as
# stale.  Transfers are bursty, so the window is deliberately generous: it is
# meant to catch "replication has been broken for days", not a quiet evening.
STALE_AFTER_SECONDS = 7 * 24 * 3600


@dataclass
class ClusterFingerprint:
    """Summary of one host's view of the cluster directory."""

    machine_id: int
    machine_name: str
    path: str
    exists: bool = False
    file_count: int = 0
    total_bytes: int = 0
    newest_epoch: int = 0
    digest: str = ""
    error: str = ""


@dataclass
class ClusterVerdict:
    """Result of comparing fingerprints across the machines of a cluster."""

    cluster_id: str
    status: str                       # "ok" | "drift" | "stale" | "unknown"
    detail: str
    fingerprints: List[ClusterFingerprint] = field(default_factory=list)


def effective_cluster_path(cluster_dir: str, cluster_id: str, *, native: bool) -> str:
    """
    Resolve where ARK actually writes, from the override root and cluster id.

    See the module docstring: ARK appends ``clusters/<ClusterID>`` itself.
    """
    if native:
        return join_win(cluster_dir, "clusters", cluster_id)
    return f"{cluster_dir.rstrip('/')}/clusters/{cluster_id}"


def probe_cmd(cluster_dir: str, cluster_id: str, adapter: PlatformAdapter) -> str:
    """
    Build the command that fingerprints the cluster directory on one host.

    Emits four ``key=value`` lines -- ``count``, ``bytes``, ``newest`` (unix
    epoch) and ``digest`` -- or ``missing=1`` when the directory is absent.
    The digest is over ``name:size`` pairs only, never mtime: replication
    tools legitimately differ on timestamps, and a false "drift" every poll
    would train the operator to ignore the indicator.
    """
    path = effective_cluster_path(cluster_dir, cluster_id, native=adapter.is_native)

    if adapter.is_native:
        return (
            f"if (-not (Test-Path {ps_quote(path)})) {{ Write-Output 'missing=1'; exit 0 }}; "
            f"$f = @(Get-ChildItem -LiteralPath {ps_quote(path)} -File "
            f"-ErrorAction SilentlyContinue); "
            f"Write-Output ('count=' + $f.Count); "
            f"$sum = 0; $f | ForEach-Object {{ $sum += $_.Length }}; "
            f"Write-Output ('bytes=' + $sum); "
            f"$newest = 0; $f | ForEach-Object {{ "
            f"$e = [int][double]::Parse(($_.LastWriteTimeUtc - "
            f"(Get-Date '1970-01-01 00:00:00Z').ToUniversalTime()).TotalSeconds); "
            f"if ($e -gt $newest) {{ $newest = $e }} }}; "
            f"Write-Output ('newest=' + $newest); "
            f"$manifest = ($f | Sort-Object Name | ForEach-Object "
            f"{{ $_.Name + ':' + $_.Length }}) -join \"`n\"; "
            f"$md5 = [System.Security.Cryptography.MD5]::Create(); "
            f"$hash = $md5.ComputeHash("
            f"[System.Text.Encoding]::UTF8.GetBytes($manifest)); "
            f"Write-Output ('digest=' + "
            f"([System.BitConverter]::ToString($hash) -replace '-','').ToLower())"
        )

    # POSIX side: one find, no subshell per file.
    quoted = path.replace("'", "'\"'\"'")
    return adapter.wrap_shell(
        f"if [ ! -d '{quoted}' ]; then echo 'missing=1'; exit 0; fi; "
        f"echo \"count=$(find '{quoted}' -maxdepth 1 -type f | wc -l)\"; "
        f"echo \"bytes=$(find '{quoted}' -maxdepth 1 -type f -printf '%s\\n' "
        f"| awk '{{s+=$1}} END {{print s+0}}')\"; "
        f"echo \"newest=$(find '{quoted}' -maxdepth 1 -type f -printf '%T@\\n' "
        f"| sort -n | tail -1 | cut -d. -f1)\"; "
        f"echo \"digest=$(find '{quoted}' -maxdepth 1 -type f -printf '%f:%s\\n' "
        f"| sort | md5sum | cut -d' ' -f1)\""
    )


def parse_probe(
    stdout: str,
    *,
    machine_id: int,
    machine_name: str,
    path: str,
) -> ClusterFingerprint:
    """Turn :func:`probe_cmd` output into a :class:`ClusterFingerprint`."""
    fp = ClusterFingerprint(
        machine_id=machine_id, machine_name=machine_name, path=path)
    values: Dict[str, str] = {}
    for line in (stdout or "").splitlines():
        line = line.strip()
        if "=" in line:
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()

    if values.get("missing") == "1":
        fp.error = "directory not found"
        return fp
    if "count" not in values:
        fp.error = "probe returned no usable output"
        return fp

    fp.exists = True
    for key, attr in (("count", "file_count"), ("bytes", "total_bytes"),
                      ("newest", "newest_epoch")):
        try:
            setattr(fp, attr, int(values.get(key) or 0))
        except ValueError:
            setattr(fp, attr, 0)
    fp.digest = values.get("digest", "")
    return fp


def compare(
    cluster_id: str,
    fingerprints: Iterable[ClusterFingerprint],
    *,
    now_epoch: int,
    stale_after: int = STALE_AFTER_SECONDS,
) -> ClusterVerdict:
    """
    Judge whether the hosts of a cluster agree on the cluster directory.

    Verdicts:

    ``ok``
        Every reachable host reports the same digest.
    ``drift``
        Digests disagree, or a host cannot see the directory at all.  This is
        the condition that silently breaks transfers.
    ``stale``
        Every host agrees, but nothing has been written for *stale_after*.
        Usually means the replicated directory is not the one the servers
        are actually launched against.
    ``unknown``
        Fewer than two hosts answered, so there is nothing to compare.
    """
    fps = list(fingerprints)
    usable = [f for f in fps if f.exists and not f.error]

    if len(fps) < 2:
        return ClusterVerdict(cluster_id, "unknown",
                              "Only one host in this cluster; nothing to compare.",
                              fps)
    if len(usable) < len(fps):
        broken = [f.machine_name for f in fps if f not in usable]
        return ClusterVerdict(
            cluster_id, "drift",
            "Cluster directory unreadable on: " + ", ".join(broken), fps)
    if len(usable) < 2:
        return ClusterVerdict(cluster_id, "unknown",
                              "Not enough hosts answered to compare.", fps)

    digests = {f.digest for f in usable}
    if len(digests) > 1:
        counts = ", ".join(f"{f.machine_name}={f.file_count}" for f in usable)
        return ClusterVerdict(
            cluster_id, "drift",
            f"Hosts disagree on the cluster directory contents ({counts}).", fps)

    newest = max(f.newest_epoch for f in usable)
    if newest and (now_epoch - newest) > stale_after:
        days = (now_epoch - newest) // 86400
        return ClusterVerdict(
            cluster_id, "stale",
            f"In sync, but nothing has been written for {days} days - check that "
            f"the replicated directory is the one the servers actually use.", fps)

    return ClusterVerdict(
        cluster_id, "ok",
        f"{usable[0].file_count} files, identical on {len(usable)} hosts.", fps)


def syncthing_probe_cmd(adapter: PlatformAdapter) -> str:
    """
    Report the host's Syncthing identity, so pairing does not need a shell.

    Emits ``syncthing=present|absent``, ``device_id=<id>`` and one
    ``folder=<path>`` line per configured folder.  Best-effort throughout: a
    host without Syncthing answers ``absent`` and exits 0, because "not
    installed" is a normal answer for an SMB or standalone host, not a fault.

    The device id comes from the binary rather than from config.xml: the file
    lists every known device with no marker for which one is local, so
    parsing it picks a peer as often as not.  Syncthing 2.x exposes it as the
    ``device-id`` subcommand while 1.x used a ``--device-id`` flag, so both
    are tried -- verified against v2.1.3, which rejects the 1.x form outright
    with ``unknown flag``.
    """
    if adapter.is_native:
        sync_dir = join_win(adapter.native_base_dir(), "tools", "syncthing")
        exe = join_win(sync_dir, "syncthing.exe")
        home = join_win(sync_dir, "config")
        cfg = join_win(home, "config.xml")
        return (
            f"if (-not (Test-Path {ps_quote(exe)})) {{ "
            f"Write-Output 'syncthing=absent'; exit 0 }}; "
            f"Write-Output 'syncthing=present'; "
            f"$id = & {ps_quote(exe)} --home={ps_quote(home)} device-id 2>$null; "
            f"if ($LASTEXITCODE -ne 0) {{ "
            f"$id = & {ps_quote(exe)} --home={ps_quote(home)} --device-id 2>$null }}; "
            f"if ($LASTEXITCODE -eq 0 -and $id) {{ "
            f"Write-Output ('device_id=' + ($id | Out-String).Trim()) }}; "
            f"if (Test-Path {ps_quote(cfg)}) {{ "
            f"Select-String -LiteralPath {ps_quote(cfg)} -Pattern 'path=\"([^\"]+)\"' "
            f"-AllMatches | ForEach-Object {{ $_.Matches }} | ForEach-Object "
            f"{{ Write-Output ('folder=' + $_.Groups[1].Value) }} }}"
        )

    # POSIX: discover the daemon's --home from its own command line, so a
    # non-default location is picked up without the operator configuring it.
    return adapter.wrap_shell(
        "BIN=$(command -v syncthing 2>/dev/null); "
        "if [ -z \"$BIN\" ]; then echo 'syncthing=absent'; exit 0; fi; "
        "echo 'syncthing=present'; "
        "HOME_DIR=$(ps -o args= -C syncthing 2>/dev/null "
        "| grep -oE -- '--home=[^ ]+' | head -1 | cut -d= -f2); "
        "if [ -z \"$HOME_DIR\" ]; then HOME_DIR=/var/lib/syncthing; fi; "
        "ID=$(\"$BIN\" --home=\"$HOME_DIR\" device-id 2>/dev/null "
        "|| \"$BIN\" --home=\"$HOME_DIR\" --device-id 2>/dev/null); "
        "if [ -n \"$ID\" ]; then echo \"device_id=$ID\"; fi; "
        "if [ -f \"$HOME_DIR/config.xml\" ]; then "
        "grep -oE 'path=\"[^\"]+\"' \"$HOME_DIR/config.xml\" "
        "| sed 's/path=\"//; s/\"$//; s/^/folder=/'; fi"
    )


@dataclass
class SyncthingInfo:
    """What a host reports about its Syncthing daemon."""

    present: bool = False
    device_id: str = ""
    folders: List[str] = field(default_factory=list)
    covers_cluster_dir: bool = False


def parse_syncthing(stdout: str, cluster_path: str) -> SyncthingInfo:
    """
    Parse :func:`syncthing_probe_cmd` output.

    ``covers_cluster_dir`` is the question that actually matters: a daemon
    replicating some other directory is worth exactly as much as no daemon at
    all, and syncing one level off the cluster path is the specific mistake
    that leaves a stale directory nobody notices.
    """
    info = SyncthingInfo()
    for line in (stdout or "").splitlines():
        line = line.strip()
        if line == "syncthing=present":
            info.present = True
        elif line.startswith("device_id="):
            info.device_id = line[len("device_id="):].strip()
        elif line.startswith("folder="):
            folder = line[len("folder="):].strip()
            if folder:
                info.folders.append(folder)

    def _norm(p: str) -> str:
        return p.replace("\\", "/").rstrip("/").lower()

    target = _norm(cluster_path)
    if target:
        info.covers_cluster_dir = any(
            target == _norm(f) or target.startswith(_norm(f) + "/")
            for f in info.folders
        )
    return info


def digest_of(names_and_sizes: Iterable[tuple]) -> str:
    """
    Compute the same digest the probes do, for tests and for local checks.

    Kept next to the probe builders on purpose: if the manifest format ever
    changes, both sides have to change here together.
    """
    manifest = "\n".join(f"{n}:{s}" for n, s in sorted(names_and_sizes))
    return hashlib.md5(manifest.encode("utf-8")).hexdigest()  # noqa: S324
