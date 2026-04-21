"""
api/routes/ssh.py — Ad-hoc SSH connection testing and remote command execution.

These endpoints accept raw SSH credentials and are intended for diagnostic use,
not for routine server management (which goes through the machines + containers
routes instead).
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.ssh.manager import SSHManager

router = APIRouter()


# ── Request schemas ────────────────────────────────────────────────────────────

class SSHConnectRequest(BaseModel):
    """Credentials for an SSH connectivity test."""
    host: str
    username: str
    password: Optional[str] = None
    key_path: Optional[str] = None
    port: int = 22


class SSHCommandRequest(BaseModel):
    """Credentials and command for a single remote execution."""
    host: str
    username: str
    password: Optional[str] = None
    key_path: Optional[str] = None
    port: int = 22
    command: str


class SCPUploadRequest(BaseModel):
    """Credentials and paths for an SCP file upload."""
    host: str
    username: str
    password: Optional[str] = None
    key_path: Optional[str] = None
    port: int = 22
    local_path: str
    remote_path: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/test-connection")
async def test_ssh_connection(req: SSHConnectRequest):
    """
    Verify that an SSH connection to *host* can be established.

    Returns:
        ``{"connected": True, "response": "<stdout>"}`` on success.

    Raises:
        HTTPException 400: Connection could not be established.
    """
    try:
        with SSHManager(
            host=req.host,
            username=req.username,
            password=req.password,
            key_path=req.key_path,
            port=req.port,
        ) as ssh:
            stdout, _, _ = ssh.execute("echo 'OK'")
            return {"connected": True, "response": stdout}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Connection failed: {exc}")


@router.post("/execute")
async def execute_command(req: SSHCommandRequest):
    """
    Run a single shell command on a remote host via SSH.

    Returns:
        Dict with ``stdout``, ``stderr``, and ``exit_code``.

    Raises:
        HTTPException 500: SSH session or command execution error.
    """
    try:
        with SSHManager(
            host=req.host,
            username=req.username,
            password=req.password,
            key_path=req.key_path,
            port=req.port,
        ) as ssh:
            stdout, stderr, exit_code = ssh.execute(req.command)
            return {"stdout": stdout, "stderr": stderr, "exit_code": exit_code}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Execution error: {exc}")


@router.post("/upload")
async def upload_file(req: SCPUploadRequest):
    """
    Upload a local file to a remote host using SCP.

    Returns:
        ``{"uploaded": True, "remote_path": "<path>"}`` on success.

    Raises:
        HTTPException 500: SCP transfer failed.
    """
    try:
        with SSHManager(
            host=req.host,
            username=req.username,
            password=req.password,
            key_path=req.key_path,
            port=req.port,
        ) as ssh:
            ssh.upload_file(req.local_path, req.remote_path)
            return {"uploaded": True, "remote_path": req.remote_path}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")
