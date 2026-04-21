"""
schemas/ssh_machine.py — Pydantic schemas for SSH machine CRUD endpoints.

Passwords and passphrases are accepted in create/update requests but are
never returned in read responses (they are stored encrypted in the database).
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class AuthMethodEnum(str, Enum):
    """Supported SSH authentication methods."""

    PASSWORD = "password"
    KEY = "key"
    KEY_PASSWORD = "key_password"


class OSTypeEnum(str, Enum):
    """Supported host operating systems."""

    LINUX = "linux"
    WINDOWS = "windows"


class SSHMachineCreate(BaseModel):
    """Fields required to register a new SSH machine."""

    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    hostname: str = Field(..., min_length=1, max_length=255)
    ip_address: Optional[str] = None
    ssh_port: int = Field(default=22, ge=1, le=65_535)
    ssh_user: str = Field(..., min_length=1, max_length=100)
    auth_method: AuthMethodEnum = AuthMethodEnum.PASSWORD

    # Credentials (accepted on write, never returned on read)
    ssh_password: Optional[str] = None
    ssh_key_path: Optional[str] = None
    ssh_passphrase: Optional[str] = None

    # ARK server paths on the remote host
    ark_root_path: str = "/opt/ark"
    ark_config_path: str = "/opt/ark/ShooterGame/Saved/Config/LinuxServer"
    ark_plugins_path: str = "/opt/ark/ShooterGame/Binaries/Linux/Plugins"

    # Host platform — controls how POK-manager and docker are invoked.
    os_type: OSTypeEnum = OSTypeEnum.LINUX
    wsl_distro: Optional[str] = Field(
        default="Ubuntu", max_length=64,
        description="WSL distribution name; only used when os_type = 'windows'.",
    )

    is_active: bool = True


class SSHMachineUpdate(BaseModel):
    """All fields are optional for partial updates."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    hostname: Optional[str] = None
    ip_address: Optional[str] = None
    ssh_port: Optional[int] = Field(None, ge=1, le=65_535)
    ssh_user: Optional[str] = None
    auth_method: Optional[AuthMethodEnum] = None
    ssh_password: Optional[str] = None
    ssh_key_path: Optional[str] = None
    ssh_passphrase: Optional[str] = None
    ark_root_path: Optional[str] = None
    ark_config_path: Optional[str] = None
    ark_plugins_path: Optional[str] = None
    os_type: Optional[OSTypeEnum] = None
    wsl_distro: Optional[str] = Field(default=None, max_length=64)
    is_active: Optional[bool] = None


class SSHMachineRead(BaseModel):
    """
    Machine data returned by read endpoints.

    SSH passwords and passphrases are intentionally excluded.
    ``ssh_key_path`` is included because it is not itself a secret.
    """

    id: int
    name: str
    description: Optional[str] = None
    hostname: str
    ip_address: Optional[str] = None
    ssh_port: int = 22
    ssh_user: str
    auth_method: AuthMethodEnum = AuthMethodEnum.PASSWORD
    ssh_key_path: Optional[str] = None
    ark_root_path: str = "/opt/ark"
    ark_config_path: str = "/opt/ark/ShooterGame/Saved/Config/LinuxServer"
    ark_plugins_path: str = "/opt/ark/ShooterGame/Binaries/Linux/Plugins"
    os_type: OSTypeEnum = OSTypeEnum.LINUX
    wsl_distro: Optional[str] = "Ubuntu"
    is_active: bool = True
    last_connection: Optional[datetime] = None
    # Status values: "unknown" | "online" | "offline" | "error"
    last_status: str = "unknown"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SSHTestResult(BaseModel):
    """Result of an SSH connectivity test."""

    success: bool
    message: str
    hostname: str
    response_time_ms: Optional[float] = None
