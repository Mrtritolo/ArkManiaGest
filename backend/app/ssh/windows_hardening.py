"""
ssh/windows_hardening.py -- Drive the Windows hardening audit from the panel.

The control catalogue itself lives in ``deploy/windows-native/harden.ps1``,
not here.  That script is the single implementation: this module uploads the
copy that ships with the running panel and parses its ``-Json`` output, so a
control can never mean one thing on the command line and another in the UI,
and an operator who ran the script by hand months ago cannot leave a stale
version behind.

Safety
------

Applying hardening over the very connection that administers the host can
strand you.  Three layers guard against it:

1. ``harden.ps1`` tags the dangerous controls ``lockout`` and refuses to
   apply them without ``-IncludeRisky``.
2. Individual fixes refuse structurally unsafe orderings -- blocking inbound
   by default with no SSH allow rule, disabling password authentication with
   no key installed.
3. This module never passes ``-IncludeRisky`` unless the caller asked for it
   explicitly, and audit is the default everywhere.

Because the panel does not know which source address the host sees it as, the
allow-list is left to the script, which reads it from ``$env:SSH_CLIENT`` (or
the established TCP connection) and so keeps the current session reachable.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional

from app.core.config import server_settings
from app.ssh.manager import SSHManager
from app.ssh.platform import PlatformAdapter
from app.ssh.windows_native import join_win, ps_quote

# Repo-relative location of the canonical script:
#   backend/app/ssh/windows_hardening.py -> ../../../deploy/windows-native
_SCRIPT_PATH = (
    Path(__file__).resolve().parents[3] / "deploy" / "windows-native" / "harden.ps1"
)

# Risk tags mirrored from the script, so the API can describe a control
# without the caller having to read PowerShell.
RISK_NONE = "none"
RISK_SERVICE = "service"
RISK_LOCKOUT = "lockout"


class HardeningError(RuntimeError):
    """The hardening script could not be run, or answered unusably."""


@dataclass
class ControlResult:
    """One control, as reported by the script."""

    id: str
    title: str
    category: str
    risk: str
    compliant: bool
    detail: str
    applied: str          # "no" | "yes" | "failed" | "skipped-risky"
    error: str


def read_script() -> str:
    """
    Return the canonical hardening script.

    Raises:
        HardeningError: The script is missing from the deployment, which
            means the install is incomplete rather than the host misbehaving.
    """
    try:
        return _SCRIPT_PATH.read_text(encoding="utf-8")
    except OSError as exc:
        raise HardeningError(
            f"Hardening script not found at {_SCRIPT_PATH}: {exc}"
        ) from exc


def build_command(
    remote_path: str,
    *,
    base_dir: str,
    game_ports: Iterable[int] = (),
    apply: bool = False,
    controls: Iterable[str] = (),
    include_risky: bool = False,
    service_account: str = "ArkManiaSvc",
) -> str:
    """
    Build the PowerShell invocation of the uploaded script.

    ``-ExecutionPolicy Bypass`` is scoped to this single process rather than
    changed machine-wide: the file is one the panel just wrote, and relaxing
    the machine policy to run it would be a hardening regression inside the
    hardening feature.
    """
    args = [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", ps_quote(remote_path),
        "-Json",
        "-BaseDir", ps_quote(base_dir),
        "-ServiceAccount", ps_quote(service_account),
    ]

    ports = [int(p) for p in game_ports]
    if ports:
        args += ["-GamePorts", ",".join(str(p) for p in ports)]

    if apply:
        args.append("-Apply")
        selected = [c for c in controls if c]
        if selected:
            args += ["-Controls", ",".join(ps_quote(c) for c in selected)]
        if include_risky:
            args.append("-IncludeRisky")

    return "powershell.exe " + " ".join(args)


def parse_output(stdout: str) -> List[ControlResult]:
    """
    Parse the script's JSON array into control results.

    PowerShell happily prepends warnings to stdout, so the payload is located
    by its first delimiter rather than assumed to start at byte zero.  Both
    ``[`` and ``{`` are accepted: ``ConvertTo-Json`` unwraps a single-element
    array into a bare object on some hosts, and a report with exactly one
    control is a normal outcome -- it is what the elevation pre-flight
    returns.
    """
    text = (stdout or "").strip()

    candidates = [
        (text.find(opener), text.rfind(closer))
        for opener, closer in (("[", "]"), ("{", "}"))
    ]
    spans = [(s, e) for s, e in candidates if s != -1 and e != -1 and e > s]
    if not spans:
        raise HardeningError(
            "Hardening script returned no JSON payload. Raw output: "
            + (text[:500] or "<empty>")
        )
    # Whichever delimiter appears first is the real payload; an object nested
    # inside the array would otherwise win on the `{` match.
    start, end = min(spans, key=lambda span: span[0])

    try:
        raw = json.loads(text[start:end + 1])
    except json.JSONDecodeError as exc:
        raise HardeningError(f"Malformed JSON from the hardening script: {exc}") from exc

    if isinstance(raw, dict):          # single control, PowerShell unwrapped it
        raw = [raw]

    out: List[ControlResult] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        out.append(ControlResult(
            id=str(item.get("id", "")),
            title=str(item.get("title", "")),
            category=str(item.get("category", "")),
            risk=str(item.get("risk", RISK_NONE)),
            compliant=bool(item.get("compliant")),
            detail=str(item.get("detail") or ""),
            applied=str(item.get("applied") or "no"),
            error=str(item.get("error") or ""),
        ))
    return out


def run_sync(
    machine: dict,
    *,
    game_ports: Iterable[int] = (),
    apply: bool = False,
    controls: Iterable[str] = (),
    include_risky: bool = False,
    service_account: str = "ArkManiaSvc",
) -> List[ControlResult]:
    """
    Upload the script to *machine* and run it.  Blocking; call from a thread.

    Raises:
        HardeningError: The host is not a native-Windows machine, the SSH
            session failed, or the script produced nothing parseable.
    """
    adapter = PlatformAdapter.from_machine(machine)
    if not adapter.is_native:
        raise HardeningError(
            "Hardening applies to machines with the native Windows runtime. "
            "A POK host runs its game servers inside Linux containers, where "
            "these controls do not apply."
        )

    base_dir = adapter.native_base_dir()
    remote_path = join_win(base_dir, "tools", "harden.ps1")
    script = read_script()

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
        raise HardeningError(f"SSH connection failed: {exc}") from exc

    try:
        try:
            ssh.upload_text(remote_path, script)
        except Exception as exc:
            raise HardeningError(
                f"Could not upload the hardening script to {remote_path}: {exc}. "
                f"Run bootstrap.ps1 first so the tools directory exists."
            ) from exc

        command = build_command(
            remote_path,
            base_dir=base_dir,
            game_ports=game_ports,
            apply=apply,
            controls=controls,
            include_risky=include_risky,
            service_account=service_account,
        )
        stdout, stderr, rc = ssh.execute(command)
    finally:
        ssh.close()

    results = parse_output(stdout)
    # The script exits non-zero only when it could not run at all (it reports
    # a failing control as data, not as an exit code), so a bad rc with a
    # parseable payload is still a usable answer.
    if not results:
        raise HardeningError(
            f"Hardening script exited {rc} with no results. {stderr[:400]}"
        )
    return results


def summarise(results: List[ControlResult]) -> dict:
    """Counts the UI shows above the table, computed once, server-side."""
    total = len(results)
    compliant = sum(1 for r in results if r.compliant)
    return {
        "total": total,
        "compliant": compliant,
        "failing": total - compliant,
        "lockout_pending": sum(
            1 for r in results if not r.compliant and r.risk == RISK_LOCKOUT
        ),
    }
