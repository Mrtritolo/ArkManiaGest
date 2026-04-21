"""
ssh/platform.py — Platform-aware wrapper for remote shell / docker / POK-manager
invocations.

ArkManiaGest supports two host flavours:

* **Linux** — SSH lands in bash; ``docker`` and ``POK-manager.sh`` are invoked
  directly.  All POK paths are absolute POSIX paths inside the host FS.

* **Windows** — SSH lands in PowerShell (via the optional Windows OpenSSH
  server).  Docker Desktop ships a Linux Docker engine through WSL2, and
  POK-manager.sh is a bash script, so every POK and ``docker`` call must be
  routed through ``wsl.exe -d <distro> -- bash -c '...'``.  The POK files
  live inside the WSL distro's Linux filesystem (e.g.
  ``/home/arkmania/arkmania``), NEVER on the Windows drive — mounting
  ``/mnt/c`` inside the ASA container kills I/O performance.

The :class:`PlatformAdapter` encapsulates these differences.  It accepts a
raw bash command and returns a string that can be passed verbatim to
:meth:`app.ssh.manager.SSHManager.execute`.  Every call site that used to
hardcode ``docker ...`` must now go through the adapter.
"""
from __future__ import annotations

import posixpath
from typing import Literal, Optional


OSType = Literal["linux", "windows"]

# Default destinations for the POK-manager bootstrap when the user leaves
# the field blank.  On Windows the path intentionally lives inside the WSL
# distro filesystem (via the WSL user's home).
DEFAULT_POK_BASE_LINUX   = "/opt/arkmania"
DEFAULT_POK_BASE_WINDOWS = "/home/arkmania/arkmania"


def _bash_single_quote(text: str) -> str:
    """
    Escape *text* so it can be wrapped in single quotes in a bash command.

    Bash single-quoted strings cannot contain a single quote, not even
    escaped.  The standard workaround is to close the quoted section, emit
    an escaped quote, and reopen:  ``'foo'"'"'bar'`` becomes ``foo'bar``.
    """
    return text.replace("'", "'\"'\"'")


class PlatformAdapter:
    """
    Wrap shell / docker / POK-manager invocations for a specific host OS.

    The adapter is cheap to construct and holds no connection state — call
    sites typically build one from an SSH machine dict just before running
    a command:

        adapter = PlatformAdapter.from_machine(machine)
        stdout, stderr, rc = ssh.execute(adapter.docker("ps --format '{{.Names}}'"))

    Attributes:
        os_type:    ``"linux"`` or ``"windows"``.
        wsl_distro: WSL distribution name targeted on Windows hosts.
                    Ignored for Linux hosts.
    """

    __slots__ = ("os_type", "wsl_distro")

    def __init__(self, os_type: OSType = "linux", wsl_distro: str = "Ubuntu") -> None:
        if os_type not in ("linux", "windows"):
            raise ValueError(f"Invalid os_type: {os_type!r}")
        self.os_type = os_type
        self.wsl_distro = wsl_distro or "Ubuntu"

    # ── Constructors ──────────────────────────────────────────────────────

    @classmethod
    def from_machine(cls, machine: dict) -> "PlatformAdapter":
        """
        Build an adapter from a machine dict returned by the store layer.

        Missing or unknown ``os_type`` values fall back to ``"linux"`` so
        that legacy rows (pre-Fase 2) keep working transparently.
        """
        os_type = str(machine.get("os_type", "linux")).lower()
        if os_type not in ("linux", "windows"):
            os_type = "linux"
        wsl_distro = machine.get("wsl_distro") or "Ubuntu"
        return cls(os_type=os_type, wsl_distro=wsl_distro)  # type: ignore[arg-type]

    # ── Core wrapping ─────────────────────────────────────────────────────

    def wrap_shell(self, bash_command: str) -> str:
        """
        Return a command string ready to be sent to the remote shell.

        The *bash_command* is written exactly as you would type it in a
        Linux terminal.  On Linux hosts it is returned unchanged; on
        Windows hosts it is wrapped in ``wsl.exe -d <distro> -- bash -c '...'``
        with proper single-quote escaping.
        """
        if self.os_type == "linux":
            return bash_command
        escaped = _bash_single_quote(bash_command)
        return f"wsl.exe -d {self.wsl_distro} -- bash -c '{escaped}'"

    # ── Docker / compose / POK ────────────────────────────────────────────

    def docker(self, subcommand: str) -> str:
        """Wrap ``docker <subcommand>`` for the host OS."""
        return self.wrap_shell(f"docker {subcommand}")

    def compose(self, subcommand: str, *, cwd: Optional[str] = None) -> str:
        """
        Wrap ``docker compose <subcommand>`` for the host OS.

        Args:
            subcommand: Everything that follows ``docker compose`` (for
                        example ``"up -d asaserver"``).
            cwd:        Optional working directory to ``cd`` into before
                        running the command — useful because compose
                        resolves ``docker-compose.yaml`` relative to CWD.
        """
        body = f"docker compose {subcommand}"
        if cwd:
            body = f"cd '{_bash_single_quote(cwd)}' && {body}"
        return self.wrap_shell(body)

    def pok(self, args: str, *, base_dir: str) -> str:
        """
        Wrap a ``POK-manager.sh <args>`` invocation.

        Args:
            args:     Arguments passed to POK-manager (e.g. ``"-start MyInst"``).
            base_dir: Directory that contains ``POK-manager.sh`` on the host
                      (typically the machine's ``pok_base_dir``).
        """
        script = posixpath.join(base_dir.rstrip("/"), "POK-manager.sh")
        body = (
            f"cd '{_bash_single_quote(base_dir)}' && "
            f"bash '{_bash_single_quote(script)}' {args}"
        )
        return self.wrap_shell(body)

    # ── Checks & helpers ──────────────────────────────────────────────────

    def prereqs_check_cmd(self) -> str:
        """
        Return a command that prints environment info for the prereqs check
        endpoint (docker version, compose version, and — on Windows — the
        WSL distro availability).
        """
        if self.os_type == "linux":
            return (
                "echo '=== uname ===' && uname -a && "
                "echo '=== docker ===' && (docker --version || echo 'docker MISSING') && "
                "echo '=== compose ===' && (docker compose version || echo 'compose MISSING')"
            )
        # Windows host: verify WSL + the target distro + docker + compose.
        bash_side = (
            "echo '=== uname ===' && uname -a && "
            "echo '=== docker ===' && (docker --version || echo 'docker MISSING') && "
            "echo '=== compose ===' && (docker compose version || echo 'compose MISSING')"
        )
        return (
            f"(wsl.exe --status 2>&1 | findstr /C:\"Default\" || echo 'WSL MISSING') "
            f"& wsl.exe -l -q 2>&1 "
            f"& {self.wrap_shell(bash_side)}"
        )

    def default_pok_base_dir(self) -> str:
        """Return the suggested POK install location for this host OS."""
        return (
            DEFAULT_POK_BASE_LINUX if self.os_type == "linux"
            else DEFAULT_POK_BASE_WINDOWS
        )

    @staticmethod
    def join_path(*parts: str) -> str:
        """
        Join path fragments using POSIX rules.

        POK-manager and its docker-compose files always use POSIX paths,
        even on Windows hosts (since the POK tree lives inside WSL).  Do
        NOT use :mod:`os.path.join` here — on a Windows-hosted panel the
        backend runtime would produce ``C:\\...`` fragments.
        """
        if not parts:
            return ""
        clean = [p for p in parts if p]
        if not clean:
            return ""
        return posixpath.join(*clean)
