"""
api/routes/servers.py — Game server CRUD placeholder.

Full implementation is planned for a future release once the game-server
management module is active.
"""
from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_servers():
    """List all configured ARK: Survival Ascended server instances."""
    return {
        "servers": [],
        "message": "Endpoint ready — CRUD implementation pending v0.3.0",
    }


@router.get("/{server_id}")
async def get_server(server_id: int):
    """Return details for a specific server (not yet implemented)."""
    return {"server_id": server_id, "message": "TODO v0.3.0"}
