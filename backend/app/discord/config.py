"""
app.discord.config — credential surface + 'is Discord configured?' helpers.

Small wrapper around :mod:`app.core.config` that the route layer can
import without growing a dependency on the full settings object every
time.  Centralises the "what's missing?" diagnostic so every endpoint
returns the same hint string when an integration step hasn't been
configured yet.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.core.config import server_settings


@dataclass(frozen=True)
class DiscordConfig:
    """Snapshot of the Discord-related .env values, post-trim."""

    client_id:     str
    client_secret: str
    bot_token:     str
    public_key:    str
    guild_id:      str
    redirect_uri:  str

    @property
    def has_oauth(self) -> bool:
        """True iff CLIENT_ID + CLIENT_SECRET are populated."""
        return bool(self.client_id and self.client_secret)

    @property
    def has_bot(self) -> bool:
        """True iff BOT_TOKEN + GUILD_ID are populated (guild API access)."""
        return bool(self.bot_token and self.guild_id)

    @property
    def has_redirect(self) -> bool:
        return bool(self.redirect_uri)

    def missing_for_oauth(self) -> list[str]:
        """Return the .env keys still empty for the OAuth flow to work."""
        gaps: list[str] = []
        if not self.client_id:     gaps.append("DISCORD_CLIENT_ID")
        if not self.client_secret: gaps.append("DISCORD_CLIENT_SECRET")
        if not self.redirect_uri:  gaps.append("DISCORD_REDIRECT_URI")
        return gaps

    def missing_for_bot(self) -> list[str]:
        """Return the .env keys still empty for guild-side calls to work."""
        gaps: list[str] = []
        if not self.bot_token: gaps.append("DISCORD_BOT_TOKEN")
        if not self.guild_id:  gaps.append("DISCORD_GUILD_ID")
        return gaps


def get_discord_config() -> DiscordConfig:
    """
    Read the Discord-related settings from the global ServerSettings,
    trimming surrounding whitespace so a stray newline in `.env` doesn't
    silently break an OAuth round-trip.
    """
    s = server_settings
    return DiscordConfig(
        client_id     = (s.DISCORD_CLIENT_ID     or "").strip(),
        client_secret = (s.DISCORD_CLIENT_SECRET or "").strip(),
        bot_token     = (s.DISCORD_BOT_TOKEN     or "").strip(),
        public_key    = (s.DISCORD_PUBLIC_KEY    or "").strip(),
        guild_id      = (s.DISCORD_GUILD_ID      or "").strip(),
        redirect_uri  = (s.DISCORD_REDIRECT_URI  or "").strip(),
    )
