"""
schemas/players.py — Pydantic schemas for player management endpoints.

Covers:
  - Player list / detail views
  - Shop points operations
  - Permission group management
  - Tribe permissions
  - Player map search (profile discovery)
  - Cross-map character copy
"""

from typing import List, Optional
from datetime import datetime

from pydantic import BaseModel, Field


# ── Player views ──────────────────────────────────────────────────────────────

class PlayerFull(BaseModel):
    """Complete player profile including shop and tribe data."""

    # Core player fields (Players table)
    id: int
    eos_id: str
    name: Optional[str] = None
    permission_groups: str = "Default,"
    timed_permission_groups: str = ""

    # Shop data (ArkShopPlayers table)
    points: Optional[int] = None
    total_spent: Optional[int] = None
    kits: Optional[str] = None

    # Tribe data (ARKM_tribe_decay / ARKM_player_tribes)
    tribe_name: Optional[str] = None
    tribe_id: Optional[int] = None

    last_login: Optional[datetime] = None


class PlayerListItem(BaseModel):
    """Compact player representation used in list / search results."""

    id: int
    eos_id: str
    name: Optional[str] = None
    permission_groups: str = ""
    timed_permission_groups: str = ""
    points: Optional[int] = None
    total_spent: Optional[int] = None
    tribe_name: Optional[str] = None
    last_login: Optional[datetime] = None


class PlayerUpdate(BaseModel):
    """Fields that can be updated on a player record (all optional)."""

    name: Optional[str] = None
    permission_groups: Optional[str] = None
    timed_permission_groups: Optional[str] = None


# ── Shop points operations ────────────────────────────────────────────────────

class PlayerPointsUpdate(BaseModel):
    """Set a player's shop points to an absolute value."""

    points: int


class PlayerPointsAdd(BaseModel):
    """Add or subtract shop points (relative delta)."""

    amount: int = Field(
        ...,
        description="Positive to add points, negative to subtract.",
    )


# ── Permission groups ─────────────────────────────────────────────────────────

class PermissionGroupRead(BaseModel):
    """A single permission group record."""

    id: int
    group_name: str
    permissions: str


class PermissionGroupUpdate(BaseModel):
    """Update the permissions string of an existing group."""

    permissions: Optional[str] = None


# ── Tribe permissions ─────────────────────────────────────────────────────────

class TribePermissionRead(BaseModel):
    """Permission assignments for a tribe."""

    id: int
    tribe_id: int
    permission_groups: str
    timed_permission_groups: str


# ── Aggregate statistics ──────────────────────────────────────────────────────

class PlayersStats(BaseModel):
    """High-level statistics for the dashboard."""

    total_players: int
    players_with_points: int
    total_points_in_circulation: int
    total_spent: int
    permission_groups_count: int


# ── Player map search ─────────────────────────────────────────────────────────

class PlayerMapResult(BaseModel):
    """A single location where a player's .arkprofile was found."""

    machine_id: int
    machine_name: str
    hostname: str
    container_name: str
    map_name: str
    map_path: str
    profile_path: str
    file_id: str
    player_name: Optional[str] = None


class PlayerMapSearchResponse(BaseModel):
    """Complete response for the player map search endpoint."""

    eos_id: str
    maps: List[PlayerMapResult]
    total: int
    errors: List[str] = []


# ── Character copy ────────────────────────────────────────────────────────────

class CopyCharacterRequest(BaseModel):
    """Parameters for copying a .arkprofile from one map/machine to another."""

    source_machine_id: int = Field(..., description="Source machine primary key.")
    source_container: str = Field(..., description="Source container directory name.")
    source_profile_path: str = Field(..., description="Full path to the source .arkprofile.")
    dest_machine_id: int = Field(..., description="Destination machine primary key.")
    dest_container: str = Field(..., description="Destination container directory name.")
    dest_map_name: str = Field(..., description="Destination map name (e.g. Aberration_WP).")
    backup: bool = Field(True, description="Back up the destination file if it already exists.")


class CopyCharacterResponse(BaseModel):
    """Result of a character copy operation."""

    success: bool
    source_path: str
    filename: str
    dest_path: str
    backup_path: Optional[str] = None
    overwritten: bool = False
    size: int = 0
