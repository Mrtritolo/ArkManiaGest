"""
ssh/windows_native.py -- Command builders for the native-Windows runtime.

This module is the native counterpart of the POK-manager command builders in
:mod:`app.ssh.pok_executor`.  It emits **PowerShell** command strings that are
handed verbatim to :meth:`app.ssh.manager.SSHManager.execute` on a Windows
host whose OpenSSH server lands in PowerShell.  No Docker, no WSL, no Proton:
``ArkAscendedServer.exe`` / ``AsaApiLoader.exe`` run straight on Windows,
supervised by a WinSW-registered Windows service.

Nothing here opens a connection or touches the database -- every function is
a pure string builder, so the whole module is unit-testable without a host.

On-disk layout
--------------

One SteamCMD installation per host is shared by every instance.  Only the
small, mutable part of the tree is copied per instance; the ~20 GB of assets
are NTFS directory junctions back into the shared install::

    <base>\\ServerFiles\\               shared SteamCMD install
    <base>\\steamcmd\\steamcmd.exe
    <base>\\Cluster\\                   ClusterDirOverride root (see note)
    <base>\\Instances\\<name>\\
        ShooterGame\\Binaries\\         REAL copy  -- AsaApiLoader.exe, the
                                        ArkApi plugin tree and AsaApi's own
                                        logs live here, and they must stay
                                        per instance
        ShooterGame\\Content\\          junction   -- the bulk of the install
        ShooterGame\\Saved\\            REAL       -- saves + per-instance INIs
        Engine\\                        junction
        service.xml                     WinSW service definition
        WinSW.exe

Copying ``Binaries`` rather than junctioning it is deliberate: AsaApi writes
``Binaries/Win64/logs/`` and loads ``Binaries/Win64/ArkApi/Plugins/``, both of
which the existing ArkMania deploy tooling treats as per-instance.  It costs
roughly 600 MB per instance against ~20 GB saved.

Cluster directory
-----------------

ARK appends ``clusters/<ClusterID>/`` to whatever ``-ClusterDirOverride``
points at.  Replication of that directory across hosts is **not** performed
here -- see :mod:`app.ssh.cluster_sync` for the health probe and
``deploy/windows-native/bootstrap.ps1`` for the Syncthing provisioning.

PowerShell dialect
------------------

Windows Server ships Windows PowerShell 5.1, so this module stays inside that
dialect: no ``&&`` / ``||`` pipeline chain operators, no ternary, no
null-coalescing.  Sequencing uses ``;`` and explicit ``if`` blocks.
"""

from __future__ import annotations

import base64
import posixpath  # noqa: F401  (kept for symmetry with platform.py; see join_win)
from typing import Iterable, Optional
from xml.sax.saxutils import escape as _xml_escape


# Steam application ID of the ARK: Survival Ascended dedicated server.
ASA_STEAM_APP_ID = "2430930"

# Default install root on a native host.  Deliberately short and off the
# user profile: ARK's asset paths are long and Windows still trips over
# MAX_PATH in places.
DEFAULT_NATIVE_BASE_DIR = "C:\\ArkMania"

# Seconds WinSW waits for a graceful exit before killing the process tree.
# ARK writes the world save on shutdown; on a large map that is slow.
SERVICE_STOP_TIMEOUT_SEC = 180


# ── Quoting helpers ───────────────────────────────────────────────────────────

def ps_quote(text: str) -> str:
    """
    Wrap *text* in a PowerShell single-quoted string literal.

    Inside single quotes PowerShell performs no expansion at all, so the
    only character needing attention is the single quote itself, which is
    escaped by doubling it.  This is the only safe way to pass an
    operator-supplied path or session name into a generated command.
    """
    return "'" + str(text).replace("'", "''") + "'"


def _b64(text: str) -> str:
    """Base64-encode *text* as UTF-8, for transport inside a command line."""
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _write_file_cmd(remote_path: str, content: str) -> str:
    """
    Build a PowerShell fragment that writes *content* to *remote_path*.

    The payload travels base64-encoded so that newlines, quotes and angle
    brackets in the file body can never be re-interpreted by the shell.
    UTF-8 without BOM is used because WinSW rejects a BOM in its XML.
    """
    return (
        f"[System.IO.File]::WriteAllText({ps_quote(remote_path)}, "
        f"[System.Text.Encoding]::UTF8.GetString("
        f"[System.Convert]::FromBase64String('{_b64(content)}')), "
        f"(New-Object System.Text.UTF8Encoding $false))"
    )


def join_win(*parts: str) -> str:
    """
    Join path fragments with backslashes.

    Mirrors :meth:`app.ssh.platform.PlatformAdapter.join_path`, but for the
    native runtime the remote paths really are Windows paths.  Never use
    :func:`os.path.join` here: the panel backend itself runs on Linux, so it
    would emit forward slashes.
    """
    clean = [str(p).strip("\\") for p in parts if p]
    if not clean:
        return ""
    head = str(parts[0]).rstrip("\\")
    if len(clean) == 1:
        return head
    return head + "\\" + "\\".join(clean[1:])


# ── Naming ────────────────────────────────────────────────────────────────────

def service_name_for(instance_name: str) -> str:
    """
    Derive the Windows service name for an instance.

    Windows service names allow neither forward nor back slashes; the panel
    already constrains instance names to a safe charset, so we only prefix
    them to keep the services grouped together in ``services.msc``.
    """
    return f"ArkMania-{instance_name}"


def instance_dir_for(base_dir: str, instance_name: str) -> str:
    """Return the per-instance directory under *base_dir*."""
    return join_win(base_dir, "Instances", instance_name)


def install_dir_for(base_dir: str) -> str:
    """Return the shared SteamCMD installation directory under *base_dir*."""
    return join_win(base_dir, "ServerFiles")


def cluster_dir_for(base_dir: str) -> str:
    """Return the cluster root under *base_dir*."""
    return join_win(base_dir, "Cluster")


# ── ARK command line ──────────────────────────────────────────────────────────

def launch_args(instance: dict, *, cluster_dir: Optional[str] = None) -> str:
    """
    Build the ARK server command line for *instance*.

    ASA takes a single ``?``-delimited URL-ish first argument followed by
    ``-``-prefixed switches.  The admin password is part of the ``?`` block,
    which is why the resulting string is only ever written into the WinSW
    XML on the host (readable by Administrators only) and never echoed into
    an audit row -- see :func:`create_cmd`.

    Args:
        instance:    Instance row as returned by the store layer, with
                     ``admin_password`` already decrypted.
        cluster_dir: Cluster root for ``-ClusterDirOverride``.  When None the
                     cluster switches are omitted entirely, which is the
                     correct behaviour for a standalone instance.
    """
    q: list[str] = [instance["map_name"], "listen"]

    session = instance.get("session_name") or instance["name"]
    q.append(f"SessionName={session}")
    q.append(f"Port={int(instance['game_port'])}")
    q.append("RCONEnabled=True")
    q.append(f"RCONPort={int(instance['rcon_port'])}")
    q.append(f"MaxPlayers={int(instance.get('max_players') or 70)}")
    if instance.get("admin_password"):
        q.append(f"ServerAdminPassword={instance['admin_password']}")
    if instance.get("server_password"):
        q.append(f"ServerPassword={instance['server_password']}")

    switches: list[str] = ["-servergamelog"]

    if cluster_dir and instance.get("cluster_id"):
        switches.append(f'-ClusterDirOverride="{cluster_dir}"')
        switches.append(f"-ClusterID={instance['cluster_id']}")

    if not instance.get("battleye"):
        switches.append("-NoBattlEye")

    mods = (instance.get("mods") or "").strip()
    if mods:
        switches.append(f"-mods={mods}")

    passive = (instance.get("passive_mods") or "").strip()
    if passive:
        switches.append(f"-passivemods={passive}")

    custom = (instance.get("custom_args") or "").strip()
    if custom:
        switches.append(custom)

    return "?".join(q) + " " + " ".join(switches)


def server_executable(instance: dict) -> str:
    """
    Pick the executable WinSW supervises.

    ``AsaApiLoader.exe`` bootstraps AsaApi and then starts the real server,
    so instances with the plugin API enabled must launch through it; the
    others go straight to ``ArkAscendedServer.exe``.
    """
    return "AsaApiLoader.exe" if instance.get("mod_api") else "ArkAscendedServer.exe"


# ── WinSW service definition ──────────────────────────────────────────────────

def winsw_xml(instance: dict, *, instance_dir: str, cluster_dir: Optional[str]) -> str:
    """
    Render the WinSW service definition for *instance*.

    Notable choices:

    * ``onfailure restart`` with a delay reproduces the Docker restart policy
      the POK runtime gets for free.
    * ``stoptimeout`` is generous because ARK saves the world on shutdown.
    * ``<log mode="roll-by-size">`` keeps stdout/stderr on disk the way
      ``docker logs`` does, so the existing log-fetch tooling has something
      to collect.
    * ``<priority>`` stays Normal: ARK's game thread is latency sensitive but
      raising priority above the scheduler's default starves the very I/O
      threads that write the save.
    """
    svc = service_name_for(instance["name"])
    exe = join_win(instance_dir, "ShooterGame", "Binaries", "Win64",
                   server_executable(instance))
    args = launch_args(instance, cluster_dir=cluster_dir)
    log_dir = join_win(instance_dir, "logs")

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<service>\n"
        f"  <id>{_xml_escape(svc)}</id>\n"
        f"  <name>{_xml_escape(svc)}</name>\n"
        f"  <description>ArkMania ASA instance "
        f"{_xml_escape(instance.get('display_name') or instance['name'])}"
        f"</description>\n"
        f"  <executable>{_xml_escape(exe)}</executable>\n"
        f"  <arguments>{_xml_escape(args)}</arguments>\n"
        f"  <workingdirectory>"
        f"{_xml_escape(join_win(instance_dir, 'ShooterGame', 'Binaries', 'Win64'))}"
        f"</workingdirectory>\n"
        "  <onfailure action=\"restart\" delay=\"15 sec\"/>\n"
        "  <resetfailure>1 hour</resetfailure>\n"
        f"  <stoptimeout>{SERVICE_STOP_TIMEOUT_SEC} sec</stoptimeout>\n"
        "  <stopparentprocessfirst>true</stopparentprocessfirst>\n"
        "  <startmode>Manual</startmode>\n"
        f"  <logpath>{_xml_escape(log_dir)}</logpath>\n"
        '  <log mode="roll-by-size">\n'
        "    <sizeThreshold>10240</sizeThreshold>\n"
        "    <keepFiles>8</keepFiles>\n"
        "  </log>\n"
        "</service>\n"
    )


# ── Lifecycle commands ────────────────────────────────────────────────────────

def start_cmd(service: str) -> str:
    """Start the instance's service.  Already-running is not an error."""
    return (
        f"$svc = Get-Service -Name {ps_quote(service)} -ErrorAction SilentlyContinue; "
        f"if ($null -eq $svc) {{ Write-Output 'not-found'; exit 1 }}; "
        f"if ($svc.Status -ne 'Running') {{ Start-Service -Name {ps_quote(service)} }}; "
        f"(Get-Service -Name {ps_quote(service)}).Status"
    )


def stop_cmd(service: str) -> str:
    """
    Stop the instance's service.

    This is the *hard* half of a stop.  Callers are expected to have already
    asked the server to save and exit over RCON -- see
    ``app.ssh.pok_executor._native_graceful_shutdown`` -- so by the time this
    runs the process has usually gone away on its own.  ``-Force`` covers the
    case where it has not, and WinSW's ``stoptimeout`` bounds the wait.
    """
    return (
        f"$svc = Get-Service -Name {ps_quote(service)} -ErrorAction SilentlyContinue; "
        f"if ($null -eq $svc) {{ Write-Output 'not-found'; exit 1 }}; "
        f"if ($svc.Status -ne 'Stopped') {{ "
        f"Stop-Service -Name {ps_quote(service)} -Force -ErrorAction Stop }}; "
        f"(Get-Service -Name {ps_quote(service)}).Status"
    )


def status_cmd(service: str) -> str:
    """
    Probe the instance state.

    Prints exactly ``running`` / ``exited`` / ``not-found`` so the shared
    mapping in :func:`app.ssh.pok_executor.exec_status_probe` -- written for
    ``docker inspect`` -- applies to native instances unchanged.
    """
    return (
        f"$svc = Get-Service -Name {ps_quote(service)} -ErrorAction SilentlyContinue; "
        f"if ($null -eq $svc) {{ Write-Output 'not-found' }} "
        f"elseif ($svc.Status -eq 'Running') {{ Write-Output 'running' }} "
        f"else {{ Write-Output 'exited' }}"
    )


def update_cmd(base_dir: str, *, validate: bool = True) -> str:
    """
    Run SteamCMD against the shared installation.

    Because the install is shared, this updates every instance on the host at
    once.  The caller is responsible for stopping them first -- the route
    layer refuses an update while any instance on the machine is running.
    """
    steamcmd = join_win(base_dir, "steamcmd", "steamcmd.exe")
    install = install_dir_for(base_dir)
    validate_arg = " validate" if validate else ""
    return (
        f"& {ps_quote(steamcmd)} +force_install_dir {ps_quote(install)} "
        f"+login anonymous +app_update {ASA_STEAM_APP_ID}{validate_arg} +quit; "
        f"if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}; "
        f"Write-Output 'steamcmd-ok'"
    )


def backup_cmd(instance_dir: str, backup_dir: str, instance_name: str, stamp: str) -> str:
    """
    Archive the instance's ``Saved`` tree.

    *stamp* is supplied by the caller rather than computed on the host, so
    the archive name matches the timestamp recorded in the audit row.  The
    caller is expected to have issued an RCON ``saveworld`` first.
    """
    saved = join_win(instance_dir, "ShooterGame", "Saved")
    target = join_win(backup_dir, f"{instance_name}_{stamp}.zip")
    return (
        f"if (-not (Test-Path {ps_quote(backup_dir)})) {{ "
        f"New-Item -ItemType Directory -Force -Path {ps_quote(backup_dir)} | Out-Null }}; "
        f"Compress-Archive -Path {ps_quote(join_win(saved, '*'))} "
        f"-DestinationPath {ps_quote(target)} -CompressionLevel Optimal -Force; "
        f"Write-Output {ps_quote(target)}"
    )


def create_cmd(
    instance: dict,
    *,
    base_dir: str,
    cluster_dir: Optional[str],
    winsw_source: Optional[str] = None,
) -> str:
    """
    Provision a native instance: directories, junctions, service, firewall.

    Idempotent by construction -- every step is guarded by a ``Test-Path`` or
    an ``-ErrorAction SilentlyContinue`` probe, so re-running it on a
    half-created instance completes the job instead of failing.

    The generated command deliberately never echoes the WinSW XML back: it
    carries the admin password in ``<arguments>``.

    Args:
        instance:      Instance row with decrypted credentials.
        base_dir:      Native install root on the host.
        cluster_dir:   Cluster root, or None to omit the cluster switches.
        winsw_source:  Path to the host's WinSW.exe.  Defaults to the copy
                       ``bootstrap.ps1`` places under ``<base>\\tools``.
    """
    name = instance["name"]
    inst = instance_dir_for(base_dir, name)
    install = install_dir_for(base_dir)
    svc = service_name_for(name)
    winsw = winsw_source or join_win(base_dir, "tools", "WinSW.exe")

    shooter = join_win(inst, "ShooterGame")
    steps: list[str] = []

    # 1. Directory skeleton.
    for d in (inst, shooter, join_win(inst, "logs"),
              join_win(shooter, "Saved")):
        steps.append(
            f"if (-not (Test-Path {ps_quote(d)})) {{ "
            f"New-Item -ItemType Directory -Force -Path {ps_quote(d)} | Out-Null }}"
        )

    # 2. Real copy of Binaries (AsaApi plugins + logs must stay per instance).
    steps.append(
        f"if (-not (Test-Path {ps_quote(join_win(shooter, 'Binaries'))})) {{ "
        f"Copy-Item -Recurse -Force "
        f"-Path {ps_quote(join_win(install, 'ShooterGame', 'Binaries'))} "
        f"-Destination {ps_quote(shooter)} }}"
    )

    # 3. Junctions for the bulk of the tree.  New-Item -ItemType Junction is
    #    available on PowerShell 5.1 and needs no elevation on NTFS.
    for link, target in (
        (join_win(shooter, "Content"), join_win(install, "ShooterGame", "Content")),
        (join_win(inst, "Engine"),     join_win(install, "Engine")),
    ):
        steps.append(
            f"if (-not (Test-Path {ps_quote(link)})) {{ "
            f"New-Item -ItemType Junction -Path {ps_quote(link)} "
            f"-Target {ps_quote(target)} | Out-Null }}"
        )

    # 4. WinSW binary + service definition, then (re)register the service.
    steps.append(
        f"Copy-Item -Force -Path {ps_quote(winsw)} "
        f"-Destination {ps_quote(join_win(inst, 'WinSW.exe'))}"
    )
    steps.append(
        _write_file_cmd(
            join_win(inst, "service.xml"),
            winsw_xml(instance, instance_dir=inst, cluster_dir=cluster_dir),
        )
    )
    steps.append(
        f"$existing = Get-Service -Name {ps_quote(svc)} -ErrorAction SilentlyContinue; "
        f"if ($null -ne $existing) {{ "
        f"& {ps_quote(join_win(inst, 'WinSW.exe'))} uninstall "
        f"{ps_quote(join_win(inst, 'service.xml'))} }}"
    )
    steps.append(
        f"& {ps_quote(join_win(inst, 'WinSW.exe'))} install "
        f"{ps_quote(join_win(inst, 'service.xml'))}; "
        f"if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}"
    )

    # 5. Firewall: game port (UDP) and RCON (TCP, loopback-only by policy --
    #    the panel reaches RCON through the SSH tunnel, never over the wire).
    steps.append(firewall_rule_cmd(name, int(instance["game_port"])))

    steps.append("Write-Output 'created'")
    return "; ".join(steps)


def firewall_rule_cmd(instance_name: str, game_port: int) -> str:
    """
    Create the inbound UDP rules for an instance, if absent.

    ARK needs the game port and the Steam query port, which ASA fixes at
    ``game_port + 1``.  RCON is intentionally *not* opened: the panel tunnels
    it over the existing SSH connection.
    """
    rule = f"ArkMania-{instance_name}"
    return (
        f"if ($null -eq (Get-NetFirewallRule -DisplayName {ps_quote(rule)} "
        f"-ErrorAction SilentlyContinue)) {{ "
        f"New-NetFirewallRule -DisplayName {ps_quote(rule)} -Direction Inbound "
        f"-Protocol UDP -LocalPort {int(game_port)},{int(game_port) + 1} "
        f"-Action Allow | Out-Null }}"
    )


def delete_cmd(instance: dict, *, base_dir: str, purge: bool = False) -> str:
    """
    Remove a native instance: stop, unregister, drop the firewall rule.

    ``purge`` additionally deletes the instance directory.  It defaults to
    False so an accidental delete never destroys a world save -- the
    junctions are removed either way, and removing a junction never touches
    the shared install it points at.
    """
    name = instance["name"]
    inst = instance_dir_for(base_dir, name)
    svc = service_name_for(name)
    steps = [
        f"$svc = Get-Service -Name {ps_quote(svc)} -ErrorAction SilentlyContinue; "
        f"if ($null -ne $svc) {{ "
        f"Stop-Service -Name {ps_quote(svc)} -Force -ErrorAction SilentlyContinue; "
        f"& {ps_quote(join_win(inst, 'WinSW.exe'))} uninstall "
        f"{ps_quote(join_win(inst, 'service.xml'))} }}",
        f"$r = Get-NetFirewallRule -DisplayName {ps_quote('ArkMania-' + name)} "
        f"-ErrorAction SilentlyContinue; "
        f"if ($null -ne $r) {{ Remove-NetFirewallRule "
        f"-DisplayName {ps_quote('ArkMania-' + name)} }}",
    ]
    if purge:
        # Remove the junctions first: Remove-Item -Recurse on a directory
        # containing a junction can follow it and delete the *target* on
        # older PowerShell builds.  Deleting the reparse points explicitly
        # first makes that impossible.
        for link in (join_win(inst, "ShooterGame", "Content"),
                     join_win(inst, "Engine")):
            steps.append(
                f"if (Test-Path {ps_quote(link)}) {{ "
                f"[System.IO.Directory]::Delete({ps_quote(link)}, $false) }}"
            )
        steps.append(
            f"if (Test-Path {ps_quote(inst)}) {{ "
            f"Remove-Item -Recurse -Force -Path {ps_quote(inst)} }}"
        )
    steps.append("Write-Output 'deleted'")
    return "; ".join(steps)


def prereqs_cmd(base_dir: str) -> str:
    """
    Report the native-runtime prerequisites of a host.

    Checked: PowerShell edition, the SteamCMD binary, the shared install, the
    MSVC 2019 redistributable (AsaApi refuses to load without it), WinSW, and
    the cluster directory.
    """
    steamcmd = join_win(base_dir, "steamcmd", "steamcmd.exe")
    install = install_dir_for(base_dir)
    winsw = join_win(base_dir, "tools", "WinSW.exe")
    server_exe = join_win(install, "ShooterGame", "Binaries", "Win64",
                          "ArkAscendedServer.exe")
    vc_key = ("HKLM:\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\X64")
    return (
        "Write-Output '=== powershell ==='; $PSVersionTable.PSVersion.ToString(); "
        "Write-Output '=== os ==='; (Get-CimInstance Win32_OperatingSystem).Caption; "
        f"Write-Output '=== steamcmd ==='; "
        f"if (Test-Path {ps_quote(steamcmd)}) {{ Write-Output 'ok' }} "
        f"else {{ Write-Output 'steamcmd MISSING' }}; "
        f"Write-Output '=== serverfiles ==='; "
        f"if (Test-Path {ps_quote(server_exe)}) {{ Write-Output 'ok' }} "
        f"else {{ Write-Output 'serverfiles MISSING' }}; "
        f"Write-Output '=== winsw ==='; "
        f"if (Test-Path {ps_quote(winsw)}) {{ Write-Output 'ok' }} "
        f"else {{ Write-Output 'winsw MISSING' }}; "
        f"Write-Output '=== msvc2019 ==='; "
        f"if (Test-Path {ps_quote(vc_key)}) {{ Write-Output 'ok' }} "
        f"else {{ Write-Output 'msvc2019 MISSING' }}; "
        f"Write-Output '=== cluster ==='; "
        f"if (Test-Path {ps_quote(cluster_dir_for(base_dir))}) {{ Write-Output 'ok' }} "
        f"else {{ Write-Output 'cluster MISSING' }}"
    )


def memory_usage_cmd(service_names: Iterable[str]) -> str:
    """
    Report the resident memory of each instance, in MiB.

    Docker enforces ``mem_limit_mb`` through a cgroup; Windows has no
    equivalent a service can be launched under, so the panel measures instead
    -- see :mod:`app.services.native_watchdog`.

    Measurement walks the service's process tree two levels deep, because
    WinSW spawns ``AsaApiLoader.exe`` which in turn spawns
    ``ArkAscendedServer.exe``: reading only the service's own process would
    report WinSW's few megabytes and never trip a threshold.

    Emits one ``<service>=<mib>`` line per running service; services that are
    stopped or absent are omitted rather than reported as zero, so the caller
    can tell "not running" from "running and tiny".
    """
    names = ",".join(ps_quote(s) for s in service_names) or "''"
    return (
        f"foreach ($svc in @({names})) {{ "
        f"$s = Get-CimInstance Win32_Service -Filter \"Name='$svc'\" "
        f"-ErrorAction SilentlyContinue; "
        f"if ($null -eq $s) {{ continue }}; "
        f"if ($s.ProcessId -eq 0) {{ continue }}; "
        f"$ids = New-Object System.Collections.ArrayList; "
        f"[void]$ids.Add($s.ProcessId); "
        f"$kids = @(Get-CimInstance Win32_Process "
        f"-Filter \"ParentProcessId=$($s.ProcessId)\" -ErrorAction SilentlyContinue); "
        f"foreach ($k in $kids) {{ [void]$ids.Add($k.ProcessId); "
        f"$g = @(Get-CimInstance Win32_Process "
        f"-Filter \"ParentProcessId=$($k.ProcessId)\" -ErrorAction SilentlyContinue); "
        f"foreach ($x in $g) {{ [void]$ids.Add($x.ProcessId) }} }}; "
        f"$ws = 0; "
        f"foreach ($id in $ids) {{ "
        f"$p = Get-Process -Id $id -ErrorAction SilentlyContinue; "
        f"if ($null -ne $p) {{ $ws += $p.WorkingSet64 }} }}; "
        f"Write-Output ($svc + '=' + [math]::Round($ws / 1MB)) }}"
    )


def instances_running_cmd(service_names: Iterable[str]) -> str:
    """
    Print the name of every supplied service that is currently Running.

    Used by the update route to refuse a SteamCMD run while instances that
    share the installation are still up.
    """
    names = ",".join(ps_quote(s) for s in service_names) or "''"
    return (
        f"@({names}) | ForEach-Object {{ "
        f"$s = Get-Service -Name $_ -ErrorAction SilentlyContinue; "
        f"if ($null -ne $s -and $s.Status -eq 'Running') {{ Write-Output $_ }} }}"
    )
