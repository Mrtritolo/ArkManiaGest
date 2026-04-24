"""
api/routes/__init__.py — Top-level API router.

Aggregates all sub-routers and applies JWT protection to every route except
the explicitly public ones listed below.

Public routes (no JWT required):
    POST /auth/login
    GET  /settings/status
    POST /settings/setup
    GET  /settings/database/test  (called before any users exist)
    /public/*                     (public website endpoints)

All other routes require at least the ``viewer`` role.
"""
from fastapi import APIRouter, Depends

from app.core.auth import require_viewer
from app.api.routes import (
    auth,
    auth_discord,
    me,
    servers,
    instance_actions,
    system_update,
    discord,
    ssh,
    settings,
    machines,
    serverforge,
    players,
    arkshop,
    blueprints,
    containers,
    arkmania_config,
    arkmania_bans,
    arkmania_rare_dinos,
    arkmania_transfer_rules,
    arkmania_decay,
    arkmania_leaderboard,
    public,
    game_config,
    sql_console,
)

router = APIRouter()

# ── Public routes (no JWT) ────────────────────────────────────────────────────
router.include_router(auth.router,     tags=["Auth"])
# Discord OAuth callback MUST be reachable without the panel JWT --
# the user is mid-redirect-flow and hasn't proven any panel identity
# yet.  The session cookie issued by the callback is the auth.
router.include_router(auth_discord.router, tags=["Auth (Discord)"])
# Player dashboard endpoints (Phase 6) -- authenticated by the disc_session
# cookie inside each handler, NOT by the panel JWT.  A Discord user with no
# linked EOS gets 403; an unauthenticated caller gets 401.  No router-level
# guard so the dependency can speak for itself.
router.include_router(me.router, prefix="/me", tags=["Me (player dashboard)"])
router.include_router(settings.router, prefix="/settings", tags=["Settings"])
router.include_router(public.router,   prefix="/public",   tags=["Public"])

# ── Protected routes (JWT with at least viewer role) ─────────────────────────
# NOTE: The dependency is applied at the router level so it covers every
# endpoint registered under each prefix without having to repeat it per handler.
_viewer = [Depends(require_viewer)]

router.include_router(
    machines.router,
    prefix="/machines", tags=["SSH Machines"], dependencies=_viewer,
)
router.include_router(
    serverforge.router,
    prefix="/sf", tags=["ServerForge"], dependencies=_viewer,
)
router.include_router(
    players.router,
    prefix="/players", tags=["Players"], dependencies=_viewer,
)
router.include_router(
    arkshop.router,
    prefix="/arkshop", tags=["ArkShop"], dependencies=_viewer,
)
router.include_router(
    arkmania_config.router,
    prefix="/arkmania", tags=["ArkMania Config"], dependencies=_viewer,
)
router.include_router(
    arkmania_bans.router,
    prefix="/arkmania/bans", tags=["ArkMania Bans"], dependencies=_viewer,
)
router.include_router(
    arkmania_rare_dinos.router,
    prefix="/arkmania/rare-dinos", tags=["ArkMania RareDinos"], dependencies=_viewer,
)
router.include_router(
    arkmania_transfer_rules.router,
    prefix="/arkmania/transfer-rules", tags=["ArkMania TransferRules"], dependencies=_viewer,
)
router.include_router(
    arkmania_decay.router,
    prefix="/arkmania/decay", tags=["ArkMania Decay"], dependencies=_viewer,
)
router.include_router(
    arkmania_leaderboard.router,
    prefix="/arkmania/leaderboard", tags=["ArkMania Leaderboard"], dependencies=_viewer,
)
router.include_router(
    blueprints.router,
    prefix="/blueprints", tags=["Blueprints"], dependencies=_viewer,
)
router.include_router(
    containers.router,
    prefix="/containers", tags=["Containers"], dependencies=_viewer,
)
router.include_router(
    game_config.router,
    prefix="/game-config", tags=["Game Config"], dependencies=_viewer,
)
router.include_router(
    servers.router,
    prefix="/servers", tags=["Servers"], dependencies=_viewer,
)
router.include_router(
    instance_actions.router,
    prefix="/instance-actions",
    tags=["Instance Actions"],
    dependencies=_viewer,
)
router.include_router(
    system_update.router,
    prefix="/system-update",
    tags=["System Update"],
    dependencies=_viewer,   # endpoint-level admin check inside the module
)
router.include_router(
    discord.router,
    prefix="/discord",
    tags=["Discord"],
    dependencies=_viewer,   # endpoint-level admin/self checks per route
)
router.include_router(
    ssh.router,
    prefix="/ssh", tags=["SSH"], dependencies=_viewer,
)
router.include_router(
    sql_console.router,
    prefix="/sql", tags=["SQL Console"], dependencies=_viewer,
)
