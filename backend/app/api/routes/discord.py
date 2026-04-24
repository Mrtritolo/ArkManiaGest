"""
api/routes/discord.py — Discord integration HTTP surface (Phase 1: diagnostic only).

Phase 1 only ships ``GET /config`` so an admin can verify that the
``.env`` keys are wired correctly BEFORE we build the OAuth flow on
top.  Subsequent phases land the actual auth + linking + sync routes
in this same module (and a sibling ``routes/auth_discord.py`` for the
OAuth callback).

See docs/DISCORD_INTEGRATION.md for the full plan and per-phase
contract.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.auth import require_admin
from app.discord.config import get_discord_config


router = APIRouter()


class DiscordConfigStatus(BaseModel):
    """Public-facing snapshot of the Discord settings."""

    # Public fields (safe to surface)
    client_id:     str
    public_key:    str
    guild_id:      str
    redirect_uri:  str
    # Booleans only -- never the actual secret values.
    has_client_secret: bool
    has_bot_token:     bool
    # Capability flags, derived from the above.
    oauth_ready:       bool
    bot_ready:         bool
    # Hint listing the .env keys still empty (e.g. ['DISCORD_BOT_TOKEN']).
    missing_for_oauth: list[str]
    missing_for_bot:   list[str]


@router.get(
    "/config",
    response_model=DiscordConfigStatus,
    dependencies=[Depends(require_admin)],
)
def get_config_status() -> DiscordConfigStatus:
    """
    Report which Discord settings are configured on this host.

    NEVER returns the secret values themselves -- only booleans.  Used
    by the upcoming Settings -> Discord page to drive the "what do I
    still need to fill in?" hint banner.
    """
    cfg = get_discord_config()
    return DiscordConfigStatus(
        client_id     = cfg.client_id,
        public_key    = cfg.public_key,
        guild_id      = cfg.guild_id,
        redirect_uri  = cfg.redirect_uri,
        has_client_secret = bool(cfg.client_secret),
        has_bot_token     = bool(cfg.bot_token),
        oauth_ready       = cfg.has_oauth and cfg.has_redirect,
        bot_ready         = cfg.has_bot,
        missing_for_oauth = cfg.missing_for_oauth(),
        missing_for_bot   = cfg.missing_for_bot(),
    )
