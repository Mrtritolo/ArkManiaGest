"""
api/routes/instance_actions.py -- Read-only view of the ARK instance action log.

Every row written to ``ARKM_instance_actions`` by :mod:`app.ssh.pok_executor`
is surfaced here.  Consumers are the Event Log page and the per-instance
drawer on the Servers page.

Rows are kept after the related instance is deleted (``machine_id`` +
``instance_name`` stay populated via ``ON DELETE SET NULL``), so this
endpoint always returns a coherent audit trail even if the operator later
tears down the instance.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.store import list_actions_async
from app.db.session import get_db
from app.schemas.instance_action import (
    ActionKind,
    ActionStatus,
    InstanceActionRead,
)


router = APIRouter()


@router.get("", response_model=List[InstanceActionRead])
async def list_actions(
    instance_id: Optional[int] = Query(default=None, ge=1),
    machine_id: Optional[int] = Query(default=None, ge=1),
    action: Optional[ActionKind] = Query(default=None),
    status: Optional[ActionStatus] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """
    List instance action log entries, most recent first.

    All filters are optional and can be freely combined (AND-joined).  The
    response is capped at ``limit`` rows; the client paginates via ``offset``.
    """
    rows = await list_actions_async(
        db,
        instance_id=instance_id,
        machine_id=machine_id,
        action=action.value if action else None,
        status=status.value if status else None,
        limit=limit,
        offset=offset,
    )
    return rows
