"""
schemas/mariadb_instance.py — Pydantic schemas for MariaDB container CRUD.

A MariaDB instance is a managed ``mariadb:*`` Docker container running on
one of the registered SSH machines, typically used as the plugin DB for
the ARK server instances co-located on the same host.

Passwords are accepted on create/update and never returned on read.
"""

from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class MariaDBStatus(str, Enum):
    """Lifecycle state of a managed MariaDB container."""

    CREATED  = "created"
    STARTING = "starting"
    RUNNING  = "running"
    STOPPING = "stopping"
    STOPPED  = "stopped"
    ERROR    = "error"


# ── Logical database / user pair ─────────────────────────────────────────────

class MariaDBDatabaseCreate(BaseModel):
    """Logical database + dedicated user to provision inside the container."""

    name: str = Field(
        ...,
        min_length=1,
        max_length=64,
        pattern=r"^[a-zA-Z0-9_]+$",
        description="MariaDB schema name.",
    )
    user: str = Field(
        ...,
        min_length=1,
        max_length=32,
        pattern=r"^[a-zA-Z0-9_]+$",
    )
    password: str = Field(..., min_length=4, max_length=128)


class MariaDBDatabaseRead(BaseModel):
    """Read-side view — user name exposed, password hidden."""

    name: str
    user: str
    has_password: bool = True


# ── Instance CRUD ────────────────────────────────────────────────────────────

class MariaDBInstanceCreate(BaseModel):
    """Fields accepted when creating a new managed MariaDB container."""

    machine_id: int = Field(..., ge=1)
    name: str = Field(
        ...,
        min_length=1,
        max_length=64,
        pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_\-]*$",
    )
    description: Optional[str] = Field(default=None, max_length=512)

    port: int = Field(default=3306, ge=1, le=65_535)
    root_password: str = Field(..., min_length=8, max_length=128)

    image: str = Field(default="mariadb:10.11", max_length=128)
    mem_limit_mb: int = Field(default=2048, ge=256, le=32_768)

    # Host directory used as the ``/var/lib/mysql`` bind mount.  When omitted
    # the API route derives it from the machine's ark_root_path and the
    # instance name.
    volume_path: Optional[str] = Field(default=None, max_length=512)

    # Optional initial list of databases/users to provision on first start.
    databases: List[MariaDBDatabaseCreate] = Field(default_factory=list)


class MariaDBInstanceUpdate(BaseModel):
    """All fields optional for partial updates."""

    description: Optional[str] = Field(default=None, max_length=512)
    port: Optional[int] = Field(default=None, ge=1, le=65_535)
    root_password: Optional[str] = Field(default=None, min_length=8, max_length=128)
    image: Optional[str] = None
    mem_limit_mb: Optional[int] = Field(default=None, ge=256, le=32_768)
    is_active: Optional[bool] = None


class MariaDBInstanceRead(BaseModel):
    """Read-only view — passwords excluded, databases list sanitised."""

    id: int
    machine_id: int
    name: str
    description: Optional[str] = None

    port: int = 3306

    container_name: str
    image: str = "mariadb:10.11"
    volume_path: str
    mem_limit_mb: int = 2048

    databases: List[MariaDBDatabaseRead] = Field(default_factory=list)

    is_active: bool = True
    status: MariaDBStatus = MariaDBStatus.CREATED
    last_status_at: Optional[datetime] = None
    last_started_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    has_root_password: bool = False

    class Config:
        from_attributes = True
