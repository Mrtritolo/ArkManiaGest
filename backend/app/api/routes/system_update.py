"""
api/routes/system_update.py -- In-place panel update endpoints.

Exposes three admin-only endpoints under ``/system-update``:

* ``GET  /preflight`` -- summarises whether the in-UI updater is usable
  on this host (sudoers configured, `server-update.sh` present, GitHub
  repo set in .env).
* ``POST /install``   -- discover the latest GitHub release, download +
  verify the Linux tarball, then launch ``server-update.sh`` detached
  so the running panel is replaced and restarted.
* ``GET  /status``    -- poll-friendly snapshot of the current (or last)
  attempt, including a tail of the live update log.

Heavy lifting lives in :mod:`app.services.self_updater`; this module is
only the HTTP shell.
"""

from __future__ import annotations

import logging
import traceback

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import require_admin
from app.core.config import server_settings
from app.services import self_updater

log = logging.getLogger("arkmaniagest.system_update")


router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class PreflightResponse(BaseModel):
    """Result of GET /system-update/preflight."""

    sudo_authorised: bool
    script_present:  bool
    repo_configured: bool
    repo:            str
    can_self_update: bool
    hint:            str


class InstallResponse(BaseModel):
    """Result of POST /system-update/install."""

    state:          str
    target_version: str | None = None
    message:        str | None = None
    progress_pct:   int | None = None


class StatusResponse(BaseModel):
    """Result of GET /system-update/status."""

    state:          str
    target_version: str | None = None
    started_at:     str | None = None
    finished_at:    str | None = None
    message:        str | None = None
    progress_pct:   int | None = None
    log_tail:       str | None = None


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get(
    "/preflight",
    response_model=PreflightResponse,
    dependencies=[Depends(require_admin)],
)
def preflight() -> PreflightResponse:
    """
    Tell the UI whether the "Install update" button can do its job.

    The two requirements are:

    1. ``deploy/server-update.sh`` exists at the install prefix
       (true on every machine deployed via full-deploy.sh).
    2. The ``arkmania`` user has a NOPASSWD sudoers entry for it
       (drop ``deploy/sudoers-arkmaniagest`` under
       ``/etc/sudoers.d/arkmaniagest`` to enable).
    """
    sudo_ok, sudo_reason = self_updater.probe_sudo_authorisation()
    script_ok = (self_updater.APP_DIR / "deploy" / "server-update.sh").exists()
    repo      = (server_settings.GITHUB_REPO or "").strip()
    repo_ok   = bool(repo) and "/" in repo

    if sudo_ok and script_ok and repo_ok:
        hint = "Ready."
    elif not script_ok:
        hint = (
            "server-update.sh not found at /opt/arkmaniagest/deploy/. "
            "Was the panel deployed with full-deploy.sh?"
        )
    elif not sudo_ok:
        # Surface the concrete sudo error instead of the old generic
        # "Sudoers entry missing" message -- makes it obvious whether
        # the file is missing, has wrong perms, or doesn't match.
        hint = (
            f"Self-update sudo probe failed: {sudo_reason}.  "
            "Install: sudo install -m 0440 "
            "/opt/arkmaniagest/deploy/sudoers-arkmaniagest "
            "/etc/sudoers.d/arkmaniagest"
        )
    elif not repo_ok:
        hint = "GITHUB_REPO is not set in backend/.env."
    else:
        hint = ""

    return PreflightResponse(
        sudo_authorised=sudo_ok,
        script_present=script_ok,
        repo_configured=repo_ok,
        repo=repo,
        can_self_update=sudo_ok and script_ok and repo_ok,
        hint=hint,
    )


@router.post(
    "/install",
    response_model=InstallResponse,
    status_code=202,
    dependencies=[Depends(require_admin)],
)
async def install_update() -> InstallResponse:
    """
    Trigger an in-place self-update.

    This call returns immediately (HTTP 202) -- the actual update runs in
    a detached subprocess that will outlive the request and even the
    backend restart it triggers.  The UI must poll ``/system-update/status``
    afterwards to learn how it went.

    Refuses to start when preflight fails (no sudoers, no script, etc.).

    Defensive logging
    -----------------
    The backend used to return an opaque 500 when run_self_update_async
    raised an unhandled exception (the v2.3.8 -> v2.3.9 ticket).  Every
    branch now persists a status row to /tmp/arkmaniagest-update-status.json
    AND logs the full traceback to backend-error.log, so the UI poll
    + tail of the error log together always answer "what went wrong"
    rather than the empty 500 + empty log we had before.
    """
    try:
        pre = preflight()
    except Exception as exc:                       # noqa: BLE001 -- want the catch-all
        tb = traceback.format_exc()
        log.exception("system-update preflight raised: %s", exc)
        self_updater.write_failure_status(
            target_version=None,
            message=f"preflight crashed: {type(exc).__name__}: {exc}",
            traceback_text=tb,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Preflight check failed: {type(exc).__name__}: {exc}",
        )

    if not pre.can_self_update:
        raise HTTPException(status_code=412, detail=pre.hint)

    try:
        status = await self_updater.run_self_update_async(
            repo=server_settings.GITHUB_REPO.strip(),
            github_token=server_settings.GITHUB_TOKEN.strip() or None,
        )
    except Exception as exc:                       # noqa: BLE001
        tb = traceback.format_exc()
        log.exception("system-update orchestrator raised: %s", exc)
        self_updater.write_failure_status(
            target_version=None,
            message=f"update orchestrator crashed: {type(exc).__name__}: {exc}",
            traceback_text=tb,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Update orchestrator crashed: {type(exc).__name__}: {exc}",
        )

    if status.state == "failed":
        # Surface failure as 500 + body so the UI can show the message.
        # run_self_update_async has already persisted the status JSON.
        raise HTTPException(status_code=500, detail=status.message or "Update failed.")

    return InstallResponse(
        state=status.state,
        target_version=status.target_version,
        message=status.message,
        progress_pct=status.progress_pct,
    )


@router.get(
    "/status",
    response_model=StatusResponse,
    dependencies=[Depends(require_admin)],
)
def get_status() -> StatusResponse:
    """
    Return the status of the most recent (or in-flight) self-update attempt.

    The log tail is capped to ~200 lines to keep the response small even
    when the UI polls every second.  Returns ``state="idle"`` (with empty
    fields) when nothing has been attempted on this boot.
    """
    s = self_updater.read_status()
    return StatusResponse(
        state=s.state,
        target_version=s.target_version,
        started_at=s.started_at,
        finished_at=s.finished_at,
        message=s.message,
        progress_pct=s.progress_pct,
        log_tail=self_updater.read_log_tail(max_lines=200) or None,
    )
