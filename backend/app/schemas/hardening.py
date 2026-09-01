"""
schemas/hardening.py -- Request/response models for the Windows hardening API.

The control catalogue is defined in ``deploy/windows-native/harden.ps1``; the
shapes here only describe how it travels over HTTP.
"""

from typing import List, Literal

from pydantic import BaseModel, Field


class HardeningControlRead(BaseModel):
    """One hardening control, as reported by the host."""

    id: str = Field(description="Stable control id, e.g. 'fw.default_deny'.")
    title: str
    category: str = Field(
        description="firewall | ssh | services | network | accounts | platform"
    )
    risk: Literal["none", "service", "lockout"] = Field(
        description=(
            "none: safe to apply unattended. "
            "service: can interrupt the game servers. "
            "lockout: can cut administrative access to the host, so it is "
            "never applied unless the caller opts in explicitly."
        )
    )
    compliant: bool
    detail: str = Field(
        description="Why it fails, or what the compliant state is."
    )
    applied: Literal["no", "yes", "failed", "skipped-risky"] = "no"
    error: str = ""


class HardeningSummary(BaseModel):
    """Counts for the header of the hardening view."""

    total: int = 0
    compliant: int = 0
    failing: int = 0
    lockout_pending: int = Field(
        default=0,
        description="Failing controls that need an explicit opt-in to apply.",
    )


class HardeningReport(BaseModel):
    """Full audit (or apply) result for one machine."""

    machine_id: int
    machine_name: str
    summary: HardeningSummary
    controls: List[HardeningControlRead] = []


class HardeningApplyRequest(BaseModel):
    """Which controls to apply, and whether risky ones are allowed."""

    controls: List[str] = Field(
        default_factory=list,
        description="Control ids to apply. Empty means every failing control "
                    "that is not tagged 'lockout'.",
    )
    include_risky: bool = Field(
        default=False,
        description=(
            "Allow controls tagged 'lockout' to be applied. These can cut "
            "administrative access: the script still refuses the structurally "
            "unsafe orderings, but the decision to try is yours."
        ),
    )
    service_account: str = Field(
        default="ArkManiaSvc",
        max_length=64,
        description="Local account the ARK services should run under.",
    )
