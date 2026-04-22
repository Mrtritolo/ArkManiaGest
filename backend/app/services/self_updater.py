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


# ── GitHub error formatter ───────────────────────────────────────────────────

def _format_github_error(
    response: "httpx.Response",
    url: str,
    *,
    had_token: bool,
) -> str:
    """
    Return a human-readable message for a non-200 GitHub API response.

    For 403/429 (rate limit) we pull ``X-RateLimit-Reset`` out of the
    headers and translate it into a minutes-until-reset string, plus a
    hint to set ``GITHUB_TOKEN`` in .env when the call went in
    unauthenticated.
    """
    code = response.status_code

    # GitHub serves 403 with rate-limit headers AND 429 on "secondary"
    # abuse limits; treat both as rate-limit scenarios.
    if code in (403, 429):
        reset_raw = response.headers.get("X-RateLimit-Reset")
        remaining = response.headers.get("X-RateLimit-Remaining", "?")
        retry_after = response.headers.get("Retry-After")

        when_str = ""
        if reset_raw:
            try:
                reset_ts = int(reset_raw)
                mins = max(0, int((reset_ts - time.time()) / 60))
                when_str = f" Try again in ~{mins} minute(s)."
            except ValueError:
                pass
        elif retry_after:
            when_str = f" Retry-After: {retry_after}s."

        token_hint = (
            "" if had_token
            else " Add GITHUB_TOKEN to backend/.env to lift the limit from "
                 "60/h anonymous to 5000/h authenticated."
        )
        return (
            f"GitHub rate limit hit (HTTP {code}, remaining={remaining}).{when_str}"
            f"{token_hint}"
        )

    if code == 404:
        return (
            f"GitHub returned 404 for {url} -- the repo has no published "
            "releases, or GITHUB_REPO is set to a non-existent repository."
        )

    if code == 401:
        return (
            "GitHub returned 401 -- the GITHUB_TOKEN in .env is invalid or "
            "expired; regenerate it on https://github.com/settings/tokens."
        )

    # Everything else: surface status + a short body excerpt.
    body = (response.text or "").strip()
    if len(body) > 200:
        body = body[:200] + "..."
    return f"GitHub returned HTTP {code} for {url} (body: {body!r})"


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
        raise RuntimeError(_format_github_error(r, url, had_token=bool(github_token)))

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
    without a password prompt.  Wraps :func:`probe_sudo_authorisation` and
    discards the diagnostic detail.
    """
    return probe_sudo_authorisation()[0]


def probe_sudo_authorisation() -> tuple[bool, str]:
    """
    Run the sudo probe used by the preflight endpoint and return
    ``(authorised, reason)``.

    The original attempt used ``sudo -n -l bash <script>`` (a strict
    "can I run this exact command" check).  That probe fails with
    recent sudo versions when the sudoers rule ends with a ``*``
    wildcard and no argument is passed, because ``sudo -l`` matches
    commands against rules in a way that requires the wildcard to
    consume at least one character.  The *actual* ``sudo -n bash
    <script> FULL AUTO`` call that spawn_update() runs matches fine,
    but the probe doesn't -- giving a false-negative UI banner.

    We now do the relaxed check instead:  list all the rules that
    apply to the current user with ``sudo -n -l`` (no command
    argument, so NOPASSWD rules are always enumerable) and look for
    our script path in the output.  It matches what a human operator
    would read in ``/etc/sudoers.d/arkmaniagest``.
    """
    script = APP_DIR / "deploy" / "server-update.sh"
    if not script.exists():
        return False, f"server-update.sh missing at {script}"

    try:
        proc = subprocess.run(
            ["sudo", "-n", "-l"],
            capture_output=True,
            text=True,
            timeout=SUDO_PROBE_TIMEOUT,
        )
    except FileNotFoundError:
        return False, "sudo binary not found in PATH"
    except subprocess.TimeoutExpired:
        return False, f"sudo probe timed out after {SUDO_PROBE_TIMEOUT}s"

    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")

    # Password-required / blocked user cases -- sudo exits non-zero and
    # writes a recognisable message to stderr.
    if "password is required" in combined.lower():
        return False, (
            "sudoers rule present but missing NOPASSWD -- check "
            "/etc/sudoers.d/arkmaniagest and reinstall from "
            "/opt/arkmaniagest/deploy/sudoers-arkmaniagest"
        )
    if "may not run sudo" in combined.lower() or "user .* is not allowed" in combined.lower():
        return False, "the running user has no sudoers rules at all"

    if proc.returncode != 0 and not proc.stdout:
        head = (combined.strip().splitlines() or ["unknown"])[0][:200]
        return False, f"sudo -n -l returned rc={proc.returncode}: {head!r}"

    # Success == our server-update.sh path appears somewhere under a
    # NOPASSWD line for root.  The sudoers file ships two forms to cover
    # different /bin/bash vs /usr/bin/bash layouts, so just string-match
    # on the script name + "NOPASSWD" context.
    stdout = proc.stdout or ""
    if "server-update.sh" in stdout and "NOPASSWD" in stdout:
        return True, "ok"

    if "server-update.sh" in stdout:
        return False, (
            "sudoers rule present but not NOPASSWD -- edit "
            "/etc/sudoers.d/arkmaniagest or reinstall from "
            "/opt/arkmaniagest/deploy/sudoers-arkmaniagest"
        )

    return False, (
        "no sudoers entry mentioning server-update.sh for this user.  "
        "Install: sudo install -m 0440 "
        "/opt/arkmaniagest/deploy/sudoers-arkmaniagest /etc/sudoers.d/arkmaniagest"
    )


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
