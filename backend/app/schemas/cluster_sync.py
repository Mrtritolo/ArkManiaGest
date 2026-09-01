"""
schemas/cluster_sync.py -- Response models for the cluster-health endpoints.

Read-only diagnostics: nothing here is ever accepted as input, so there is
no Create/Update pair.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class SyncthingRead(BaseModel):
    """What a host reports about its Syncthing daemon, for pairing."""

    present: bool = False
    device_id: str = Field(
        default="",
        description="Public key fingerprint used to pair this host with the "
                    "others. Not a secret: it is meant to be exchanged.",
    )
    folders: List[str] = []
    covers_cluster_dir: bool = Field(
        default=False,
        description="Whether a configured folder actually covers the directory "
                    "ARK writes to. A daemon replicating something else is "
                    "worth as much as no daemon at all.",
    )


class ClusterMemberRead(BaseModel):
    """One host's view of a cluster directory."""

    machine_id: int
    machine_name: str
    path: str = Field(
        default="",
        description="Directory ARK actually writes to on this host "
                    "(<cluster_dir>/clusters/<cluster_id>).",
    )
    exists: bool = False
    file_count: int = 0
    total_bytes: int = 0
    newest_epoch: int = Field(
        default=0,
        description="Unix timestamp of the most recently written file, 0 if none.",
    )
    syncthing: Optional[SyncthingRead] = None
    digest: str = Field(
        default="",
        description="MD5 over the sorted 'name:size' manifest. Timestamps are "
                    "excluded on purpose: replication tools legitimately "
                    "differ on them.",
    )
    error: str = ""


class ClusterHealthRead(BaseModel):
    """Verdict for one cluster across every host that runs part of it."""

    cluster_id: str
    status: Literal["ok", "drift", "stale", "unknown"] = Field(
        description=(
            "ok: every host reports an identical directory. "
            "drift: hosts disagree, or one cannot read it - transfers are "
            "silently broken. "
            "stale: hosts agree but nothing has been written for a long time, "
            "which usually means replication targets the wrong directory. "
            "unknown: fewer than two hosts to compare."
        )
    )
    detail: str
    members: List[ClusterMemberRead] = []
