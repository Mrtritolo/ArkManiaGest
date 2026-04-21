"""
schemas/server_instance.py — Pydantic schemas for ARK server instance CRUD.

A server instance represents a single Docker container (managed via POK-
manager on a remote host) running an ARK: Survival Ascended dedicated
server.  Passwords are accepted on create/update and never returned on read.
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ── Enums ─────────────────────────────────────────────────────────────────────

class InstanceStatus(str, Enum):
    """Lifecycle state of a managed ARK server container."""

    CREATED   = "created"
    STARTING  = "starting"
    RUNNING   = "running"
    STOPPING  = "stopping"
    STOPPED   = "stopped"
    UPDATING  = "updating"
    ERROR     = "error"


class UpdateCoordinationRole(str, Enum):
    """POK-manager multi-instance update coordination role."""

    MASTER   = "MASTER"
    FOLLOWER = "FOLLOWER"


# ── Create ────────────────────────────────────────────────────────────────────

class ServerInstanceCreate(BaseModel):
    """Fields accepted when creating a new ARK server instance."""

    machine_id: int = Field(..., ge=1)
    name: str = Field(
        ...,
        min_length=1,
        max_length=64,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_\-]*$",
        description="Slug used for container name and instance directory.",
    )
    display_name: str = Field(default="", max_length=128)
    description: Optional[str] = Field(default=None, max_length=512)

    # Gameplay
    map_name: str = Field(default="TheIsland_WP", max_length=64)
    session_name: str = Field(default="", max_length=128)
    max_players: int = Field(default=70, ge=1, le=500)
    cluster_id: Optional[str] = Field(default=None, max_length=64)
    mods: Optional[str] = None
    passive_mods: Optional[str] = None
    custom_args: Optional[str] = None

    # Credentials (never returned on read)
    admin_password: str = Field(..., min_length=4, max_length=128)
    server_password: Optional[str] = Field(default=None, max_length=128)

    # Network — port conflicts are validated by the API route against existing
    # instances on the same machine.
    game_port: int = Field(default=7777, ge=1, le=65_535)
    rcon_port: int = Field(default=27020, ge=1, le=65_535)

    # Docker runtime
    image: str = Field(default="acekorneya/asa_server:2_1_latest", max_length=128)
    mem_limit_mb: int = Field(default=16_384, ge=1024, le=131_072)
    timezone: str = Field(default="Europe/Rome", max_length=64)

    # Feature flags
    mod_api: bool = False
    battleye: bool = False
    update_server: bool = True
    update_coordination_role: UpdateCoordinationRole = UpdateCoordinationRole.FOLLOWER
    update_coordination_priority: int = Field(default=1, ge=0, le=100)
    cpu_optimization: bool = False

    # Host paths — optional; defaults are derived from the machine's
    # ark_root_path when omitted.
    pok_base_dir: Optional[str] = Field(default=None, max_length=512)


# ── Update ────────────────────────────────────────────────────────────────────

class ServerInstanceUpdate(BaseModel):
    """All fields optional for partial updates."""

    display_name: Optional[str] = Field(default=None, max_length=128)
    description: Optional[str] = Field(default=None, max_length=512)

    map_name: Optional[str] = Field(default=None, max_length=64)
    session_name: Optional[str] = Field(default=None, max_length=128)
    max_players: Optional[int] = Field(default=None, ge=1, le=500)
    cluster_id: Optional[str] = None
    mods: Optional[str] = None
    passive_mods: Optional[str] = None
    custom_args: Optional[str] = None

    admin_password: Optional[str] = Field(default=None, min_length=4, max_length=128)
    server_password: Optional[str] = Field(default=None, max_length=128)

    game_port: Optional[int] = Field(default=None, ge=1, le=65_535)
    rcon_port: Optional[int] = Field(default=None, ge=1, le=65_535)

    image: Optional[str] = None
    mem_limit_mb: Optional[int] = Field(default=None, ge=1024, le=131_072)
    timezone: Optional[str] = None

    mod_api: Optional[bool] = None
    battleye: Optional[bool] = None
    update_server: Optional[bool] = None
    update_coordination_role: Optional[UpdateCoordinationRole] = None
    update_coordination_priority: Optional[int] = Field(default=None, ge=0, le=100)
    cpu_optimization: Optional[bool] = None

    is_active: Optional[bool] = None


# ── Read ──────────────────────────────────────────────────────────────────────

class ServerInstanceRead(BaseModel):
    """Fields returned by read endpoints — passwords excluded."""

    id: int
    machine_id: int
    name: str
    display_name: str = ""
    description: Optional[str] = None

    map_name: str = "TheIsland_WP"
    session_name: str = ""
    max_players: int = 70
    cluster_id: Optional[str] = None
    mods: Optional[str] = None
    passive_mods: Optional[str] = None
    custom_args: Optional[str] = None

    game_port: int = 7777
    rcon_port: int = 27020

    container_name: str
    image: str = "acekorneya/asa_server:2_1_latest"
    mem_limit_mb: int = 16_384
    timezone: str = "Europe/Rome"

    pok_base_dir: str
    instance_dir: str

    mod_api: bool = False
    battleye: bool = False
    update_server: bool = True
    update_coordination_role: UpdateCoordinationRole = UpdateCoordinationRole.FOLLOWER
    update_coordination_priority: int = 1
    cpu_optimization: bool = False

    is_active: bool = True
    status: InstanceStatus = InstanceStatus.CREATED
    last_status_at: Optional[datetime] = None
    last_started_at: Optional[datetime] = None
    last_stopped_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    # Convenience flags: True when a password is configured (value is never
    # exposed).
    has_admin_password: bool = False
    has_server_password: bool = False

    class Config:
        from_attributes = True
