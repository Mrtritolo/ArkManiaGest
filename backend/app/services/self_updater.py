"""
services/self_updater.py -- In-place panel update from a GitHub release.

The frontend's "Install update" button (Settings -> General -> Updates) hits
``POST /system-update/install``, which delegates here:

1. :func:`find_latest_release` queries GitHub for the latest release of the
   configured repo and locates the Linux tarball asset + its SHA256SUMS
   sibling.
2. :func:`download_and_verify` streams the tarball to /tmp, then verifies
   its SHA-256 against the line in SHA256SUMS.
3. :func:`spawn_update` launches ``server-update.sh FULL`` via
   ``sudo -n bash`` in a fully detached process, so when the script
   restarts the panel (which kills the parent uvicorn worker) the update
   itself keeps running to completion.

A simple JSON status file (``/tmp/arkmaniagest-update-status.json``) is
maintained throughout so the UI can poll progress without holding open
HTTP requests.

Security model
~~~~~~~~~~~~~~
Only the ``arkmania`` system user is sudo-allowed to run the literal
``server-update.sh`` path -- see ``deploy/sudoers-arkmaniagest``.
The downloaded tarball is checksum-verified before the script ever sees
it; a failed checksum aborts before any code is replaced.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx


# ── Constants ────────────────────────────────────────────────────────────────

# Where downloaded artefacts and the live status file are kept.  /tmp is
# tmpfs on most Linuxes, which is fine -- we want this gone after reboot.
TARBALL_PATH = Path("/tmp/arkmaniagest-update.tar.gz")
STATUS_PATH  = Path("/tmp/arkmaniagest-update-status.json")
LOG_PATH     = Path("/tmp/arkmaniagest-update.log")

# Where the panel itself lives on disk.  This is fixed by the installer
# (deploy/full-deploy.sh + deploy/install-panel.sh) -- if a future deploy
# moves it, change here too.
APP_DIR = Path("/opt/arkmaniagest")

# Recognised filename pattern for the asset we want to install.
LINUX_ASSET_RE = re.compile(r"^arkmaniagest-v?[\w.\-]+-linux\.tar\.gz$")
SHA256_FILE_NAMES = ("SHA256SUMS", "SHA256SUMS.txt")

GITHUB_API_TIMEOUT = 10.0
GITHUB_DOWNLOAD_TIMEOUT = 300.0
SUDO_PROBE_TIMEOUT = 5.0


# ── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class ReleaseAssets:
    """Resolved download URLs + version for the latest GitHub release."""

    tag: str               # "v2.3.4"
    version: str           # "2.3.4"
    tarball_url: str
    tarball_name: str      # "arkmaniagest-v2.3.4-linux.tar.gz"
    sha256_url: Optional[str]
    sha256_name: Optional[str]
    release_url: Optional[str]
    release_notes: Optional[str]


@dataclass
class UpdateStatus:
    """
    Snapshot of the in-flight (or last finished) update attempt.

    The HTTP layer surfaces this verbatim; the UI displays it in the
    Updates card and polls every couple of seconds.
    """

    state: str             # "idle" | "downloading" | "verifying" | "running" | "success" | "failed"
    target_version: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    message: Optional[str] = None
    progress_pct: Optional[int] = None
    log_tail: Optional[str] = None


# ── Status file helpers ──────────────────────────────────────────────────────

def _write_status(status: UpdateStatus) -> None:
    """Atomically replace the JSON status file."""
    tmp = STATUS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(asdict(status), indent=2), encoding="utf-8")
    tmp.replace(STATUS_PATH)


def read_status() -> UpdateStatus:
    """
    Read the current update status.

    Returns the ``idle`` sentinel (without writing it) when no attempt has
    happened yet on this boot.
    """
    if not STATUS_PATH.exists():
        return UpdateStatus(state="idle")
    try:
        data = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return UpdateStatus(state="idle")
    return UpdateStatus(**{
        k: data.get(k) for k in UpdateStatus.__dataclass_fields__.keys()
    })


def read_log_tail(max_lines: int = 200) -> str:
    """Return the last *max_lines* of the update log file (or empty string)."""
    if not LOG_PATH.exists():
        return ""
    try:
        # Read in binary, decode lossily so a stray non-UTF-8 byte never
        # crashes the polling endpoint.
        raw = LOG_PATH.read_bytes()
        text = raw.decode("utf-8", errors="replace")
        lines = text.splitlines()
        return "\n".join(lines[-max_lines:])
    except Exception:
        return ""


# ── GitHub release discovery ─────────────────────────────────────────────────

async def find_latest_release(
    *,
    repo: str,
    github_token: Optional[str] = None,
) -> ReleaseAssets:
    """
    Hit GitHub's releases/latest endpoint and resolve the Linux asset URL.

    Raises:
        RuntimeError: GitHub returned a non-200 response, the release has
                      no Linux tarball, or the metadata is malformed.
    """
    if not repo or "/" not in repo:
        raise RuntimeError("GITHUB_REPO is not configured in .env.")

    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "ArkManiaGest-SelfUpdate",
    }
    if github_token:
        headers["Authorization"] = f"Bearer {github_token}"

    url = f"https://api.github.com/repos/{repo}/releases/latest"
    async with httpx.AsyncClient(timeout=GITHUB_API_TIMEOUT) as client:
        r = await client.get(url, headers=headers)
    if r.status_code != 200:
        raise RuntimeError(
            f"GitHub returned HTTP {r.status_code} for {url} "
            f"(body: {r.text[:200]!r})."
        )

    data = r.json()
    tag = str(data.get("tag_name") or data.get("name") or "").strip()
    if not tag:
        raise RuntimeError("GitHub release has no tag_name.")
    version = tag.lstrip("vV")

    assets = data.get("assets") or []
    tarball = next(
        (a for a in assets if LINUX_ASSET_RE.match(str(a.get("name") or ""))),
        None,
    )
    if not tarball:
        names = [a.get("name") for a in assets]
        raise RuntimeError(
            f"No Linux tarball asset found in release {tag}.  "
            f"Saw: {names!r}"
        )

    sha256_asset = next(
        (a for a in assets if str(a.get("name")) in SHA256_FILE_NAMES),
        None,
    )

    return ReleaseAssets(
        tag=tag,
        version=version,
        tarball_url=tarball["browser_download_url"],
        tarball_name=tarball["name"],
        sha256_url=sha256_asset["browser_download_url"] if sha256_asset else None,
        sha256_name=sha256_asset["name"] if sha256_asset else None,
        release_url=data.get("html_url"),
        release_notes=data.get("body"),
    )


# ── Download + verify ────────────────────────────────────────────────────────

def _parse_sha256_for(filename: str, sha256_text: str) -> Optional[str]:
    """
    Find the SHA-256 hash for *filename* inside a SHA256SUMS file.

    Standard line format is ``<hex>  <filename>`` with two spaces; we accept
    arbitrary whitespace in case the publisher used a different tool.
    """
    for line in sha256_text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(None, 1)
        if len(parts) != 2:
            continue
        hash_, name = parts[0].strip(), parts[1].strip().lstrip("*")
        if name == filename:
            return hash_.lower()
    return None


async def download_and_verify(
    assets: ReleaseAssets,
    *,
    expected_sha256: Optional[str] = None,
) -> Path:
    """
    Stream the tarball + SHA256SUMS to /tmp and verify the digest.

    If *expected_sha256* is provided it overrides whatever SHA256SUMS says
    (callers should leave it None in production).

    Returns the path to the verified tarball.

    Raises:
        RuntimeError: Download failed, SHA256SUMS missing, or hash mismatch.
    """
    # Make sure we don't operate on a stale leftover from an aborted run.
    if TARBALL_PATH.exists():
        TARBALL_PATH.unlink()

    async with httpx.AsyncClient(
        timeout=GITHUB_DOWNLOAD_TIMEOUT,
        follow_redirects=True,
    ) as client:
        # 1. Tarball.  Stream to disk so a 50MB asset doesn't sit in RAM.
        async with client.stream("GET", assets.tarball_url) as resp:
            if resp.status_code != 200:
                raise RuntimeError(
                    f"Tarball download HTTP {resp.status_code} from "
                    f"{assets.tarball_url}"
                )
            with TARBALL_PATH.open("wb") as fh:
                async for chunk in resp.aiter_bytes(chunk_size=64 * 1024):
                    fh.write(chunk)

        # 2. SHA256SUMS (optional but strongly preferred).
        sha256_text = ""
        if assets.sha256_url:
            r2 = await client.get(assets.sha256_url)
            if r2.status_code == 200:
                sha256_text = r2.text

    expected = expected_sha256
    if not expected and sha256_text:
        expected = _parse_sha256_for(assets.tarball_name, sha256_text)

    if not expected:
        # Without a published checksum we refuse to proceed -- this avoids
        # the "TOFU on every release" anti-pattern.  The release workflow
        # already publishes SHA256SUMS, so its absence usually means the
        # asset is truncated or someone is in the middle of editing the
        # release.
        TARBALL_PATH.unlink(missing_ok=True)
        raise RuntimeError(
            f"No SHA-256 hash for {assets.tarball_name} in SHA256SUMS "
            "(or SHA256SUMS missing).  Refusing to install."
        )

    actual = _sha256_of(TARBALL_PATH)
    if actual.lower() != expected.lower():
        TARBALL_PATH.unlink(missing_ok=True)
        raise RuntimeError(
            f"SHA-256 mismatch on {assets.tarball_name}: "
            f"expected {expected}, got {actual}"
        )

    return TARBALL_PATH


def _sha256_of(path: Path, chunk: int = 1024 * 1024) -> str:
    """Compute the SHA-256 of *path* without loading it whole into memory."""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for buf in iter(lambda: fh.read(chunk), b""):
            h.update(buf)
    return h.hexdigest()


# ── sudo probe + spawn ───────────────────────────────────────────────────────

def is_self_update_authorised() -> bool:
    """
    Return True iff the running user can invoke ``sudo -n bash server-update.sh``
    without a password prompt.

    Used by the UI to enable / disable the "Install update" button up
    front so the operator gets a clear "you need to drop the sudoers
    snippet first" message instead of a half-completed update.
    """
    script = APP_DIR / "deploy" / "server-update.sh"
    if not script.exists():
        return False
    try:
        # `sudo -n -l <command>` lists allowed commands matching <command>;
        # exit code 0 == allowed, 1 == not allowed (or no sudoers entry).
        proc = subprocess.run(
            ["sudo", "-n", "-l", "bash", str(script)],
            capture_output=True,
            text=True,
            timeout=SUDO_PROBE_TIMEOUT,
        )
        return proc.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def spawn_update(target_version: str) -> int:
    """
    Launch ``server-update.sh FULL`` in a detached subprocess and return its PID.

    The process is intentionally orphaned with ``setsid`` + a fresh stdio
    so that when the update restarts the systemd unit (which kills the
    parent uvicorn worker, and therefore this Python interpreter) the
    update itself keeps running until completion.  The status file and
    log file then carry the result over to the next backend boot.
    """
    if not TARBALL_PATH.exists():
        raise RuntimeError(
            f"Update tarball missing at {TARBALL_PATH} -- "
            "did download_and_verify run?"
        )

    script = APP_DIR / "deploy" / "server-update.sh"
    if not script.exists():
        raise RuntimeError(f"server-update.sh not found at {script}")

    # Open the log file for the child to inherit; truncate it so a stale
    # log from a previous run doesn't pollute the UI tail.
    log_fh = open(LOG_PATH, "wb", buffering=0)

    # `start_new_session=True` calls setsid() in the child, detaching it
    # from the parent's process group -- so when systemd kills the panel
    # process group on restart, the update keeps going.
    proc = subprocess.Popen(
        ["sudo", "-n", "bash", str(script), "FULL", "AUTO"],
        stdin=subprocess.DEVNULL,
        stdout=log_fh,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        close_fds=True,
        cwd=str(APP_DIR),
    )

    _write_status(UpdateStatus(
        state="running",
        target_version=target_version,
        started_at=datetime.now(timezone.utc).isoformat(),
        message="server-update.sh started in the background.",
    ))

    return proc.pid


# ── Top-level orchestration (called by the API route) ────────────────────────

async def run_self_update_async(
    *,
    repo: str,
    github_token: Optional[str] = None,
) -> UpdateStatus:
    """
    End-to-end orchestrator: discover -> download -> verify -> spawn.

    Updates the JSON status file at every transition.  Never raises --
    failures are reported via the returned :class:`UpdateStatus` object
    (and persisted to the status file).
    """
    started_at = datetime.now(timezone.utc).isoformat()

    # 1. Discover.
    _write_status(UpdateStatus(
        state="downloading",
        started_at=started_at,
        message="Resolving latest release on GitHub...",
        progress_pct=5,
    ))
    try:
        assets = await find_latest_release(repo=repo, github_token=github_token)
    except Exception as exc:
        status = UpdateStatus(
            state="failed",
            started_at=started_at,
            finished_at=datetime.now(timezone.utc).isoformat(),
            message=f"GitHub release lookup failed: {exc}",
        )
        _write_status(status)
        return status

    # 2. Download + verify.
    _write_status(UpdateStatus(
        state="downloading",
        target_version=assets.version,
        started_at=started_at,
        message=f"Downloading {assets.tarball_name}...",
        progress_pct=20,
    ))
    try:
        await download_and_verify(assets)
    except Exception as exc:
        status = UpdateStatus(
            state="failed",
            target_version=assets.version,
            started_at=started_at,
            finished_at=datetime.now(timezone.utc).isoformat(),
            message=str(exc),
        )
        _write_status(status)
        return status

    # 3. Spawn detached.
    _write_status(UpdateStatus(
        state="running",
        target_version=assets.version,
        started_at=started_at,
        message="Tarball verified; launching server-update.sh ...",
        progress_pct=60,
    ))
    try:
        pid = spawn_update(assets.version)
    except Exception as exc:
        status = UpdateStatus(
            state="failed",
            target_version=assets.version,
            started_at=started_at,
            finished_at=datetime.now(timezone.utc).isoformat(),
            message=f"Could not launch update: {exc}",
        )
        _write_status(status)
        return status

    return UpdateStatus(
        state="running",
        target_version=assets.version,
        started_at=started_at,
        message=f"Update started (pid {pid}); the panel will restart shortly.",
        progress_pct=70,
    )
