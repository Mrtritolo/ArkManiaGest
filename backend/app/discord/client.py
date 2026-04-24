"""
app.discord.client — Thin async httpx wrapper for the Discord REST API.

Two auth modes are supported, picked per-call:

  * **Bot token**     — for guild-side operations (read members, add /
                        remove roles).  Header: ``Authorization: Bot <token>``.
  * **Bearer token**  — for per-user operations (read the user's profile,
                        list their guilds).  Header: ``Authorization: Bearer
                        <access_token>``.

The wrapper is intentionally thin: no automatic refresh-token rotation
yet (will land in Phase 2 once we have the linked-account store), and
no automatic retry on 5xx (Discord 5xx is rare; let it surface).

Rate limits ARE handled: every response sets ``X-RateLimit-*`` headers
and a 429 carries a ``Retry-After`` body field; we honour it once with
a single retry and re-raise on a second 429.

Request bodies and response payloads pass through as plain dicts
(:class:`httpx.Response.json`) -- typed parsing happens in the route
layer, not here, because the shape of Discord responses changes more
often than typed schemas track.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Mapping, Optional

import httpx


log = logging.getLogger("arkmaniagest.discord")

API_BASE       = "https://discord.com/api/v10"
DEFAULT_TIMEOUT = 10.0


class DiscordAPIError(RuntimeError):
    """Raised when Discord returns a non-2xx response."""

    def __init__(
        self,
        status: int,
        body: Any,
        *,
        method: str = "",
        url: str = "",
    ) -> None:
        self.status = status
        self.body   = body
        self.method = method
        self.url    = url
        # Discord error envelopes look like
        #     {"message": "...", "code": 50013, "errors": {...}}
        # for normal API errors, and like
        #     {"error": "...", "error_description": "..."}
        # for OAuth errors.  Pick whichever is present.
        message = ""
        if isinstance(body, Mapping):
            message = (
                str(body.get("message")
                    or body.get("error_description")
                    or body.get("error")
                    or body)[:300]
            )
        else:
            message = str(body)[:300]
        super().__init__(
            f"Discord {method} {url} -> HTTP {status}: {message}"
        )


def _auth_header(*, bot_token: Optional[str], bearer_token: Optional[str]) -> dict[str, str]:
    """Build the ``Authorization`` header for the chosen auth mode."""
    if bot_token:
        return {"Authorization": f"Bot {bot_token}"}
    if bearer_token:
        return {"Authorization": f"Bearer {bearer_token}"}
    return {}


async def _request(
    method:        str,
    path:          str,
    *,
    bot_token:     Optional[str] = None,
    bearer_token:  Optional[str] = None,
    json_body:     Optional[Mapping[str, Any]] = None,
    form_body:     Optional[Mapping[str, Any]] = None,
    query:         Optional[Mapping[str, Any]] = None,
    timeout:       float = DEFAULT_TIMEOUT,
    _retried:      bool  = False,
) -> Any:
    """
    Internal one-shot Discord API call with single 429 retry.

    Either ``bot_token`` or ``bearer_token`` must be set (not both -- the
    caller picks which auth mode is appropriate for the endpoint).

    Returns the decoded JSON body on success; raises :class:`DiscordAPIError`
    on a non-2xx response (after the retry on 429).
    """
    if bot_token and bearer_token:
        raise ValueError("Pass either bot_token OR bearer_token, not both.")

    url = path if path.startswith("http") else f"{API_BASE}{path}"
    headers = {
        "Accept":     "application/json",
        "User-Agent": "ArkManiaGest-Panel (https://arkmania.it, 1.0)",
        **_auth_header(bot_token=bot_token, bearer_token=bearer_token),
    }
    # Discord's token-exchange endpoint requires application/x-www-form-urlencoded.
    request_kwargs: dict[str, Any] = {
        "params":  dict(query) if query else None,
        "headers": headers,
    }
    if form_body is not None:
        request_kwargs["data"] = dict(form_body)
    elif json_body is not None:
        request_kwargs["json"] = dict(json_body)

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.request(method, url, **{k: v for k, v in request_kwargs.items() if v is not None})

    # Successful 2xx -- return decoded JSON when present, else None.
    if 200 <= resp.status_code < 300:
        if resp.status_code == 204 or not resp.content:
            return None
        try:
            return resp.json()
        except ValueError:
            return resp.text

    # 429 -- honour Retry-After exactly once.
    if resp.status_code == 429 and not _retried:
        try:
            body = resp.json()
        except ValueError:
            body = {}
        retry_after_s = float(body.get("retry_after")
                              or resp.headers.get("Retry-After", "1"))
        log.warning(
            "Discord %s %s -> 429; sleeping %.2fs and retrying once",
            method, url, retry_after_s,
        )
        await asyncio.sleep(min(retry_after_s, 30.0))
        return await _request(
            method, path,
            bot_token=bot_token, bearer_token=bearer_token,
            json_body=json_body, form_body=form_body, query=query,
            timeout=timeout, _retried=True,
        )

    # Other 4xx / 5xx -- decode error envelope and raise.
    try:
        error_body: Any = resp.json()
    except ValueError:
        error_body = resp.text
    raise DiscordAPIError(resp.status_code, error_body, method=method, url=url)


# ── Public helpers ────────────────────────────────────────────────────────────
# Each helper picks the right auth mode and binds method + path.  The route
# layer never composes Authorization headers by hand.

async def exchange_code(
    *,
    client_id:     str,
    client_secret: str,
    code:          str,
    redirect_uri:  str,
) -> dict:
    """
    POST /oauth2/token with ``grant_type=authorization_code``.

    Returns the token envelope:
        {access_token, token_type, expires_in, refresh_token, scope}
    """
    return await _request(
        "POST", "/oauth2/token",
        form_body={
            "client_id":     client_id,
            "client_secret": client_secret,
            "grant_type":    "authorization_code",
            "code":          code,
            "redirect_uri":  redirect_uri,
        },
    )


async def refresh_token(
    *,
    client_id:     str,
    client_secret: str,
    refresh_token: str,
) -> dict:
    """POST /oauth2/token with ``grant_type=refresh_token``."""
    return await _request(
        "POST", "/oauth2/token",
        form_body={
            "client_id":     client_id,
            "client_secret": client_secret,
            "grant_type":    "refresh_token",
            "refresh_token": refresh_token,
        },
    )


async def revoke_token(
    *,
    client_id:     str,
    client_secret: str,
    token:         str,
) -> None:
    """Best-effort token revocation -- swallow errors so unlink can't fail."""
    try:
        await _request(
            "POST", "/oauth2/token/revoke",
            form_body={
                "client_id":     client_id,
                "client_secret": client_secret,
                "token":         token,
            },
        )
    except DiscordAPIError as exc:
        log.warning("Discord revoke failed (ignored): %s", exc)


async def get_current_user(*, bearer_token: str) -> dict:
    """GET /users/@me -- returns the user's profile (id, username, avatar, ...)."""
    return await _request("GET", "/users/@me", bearer_token=bearer_token)


async def list_guild_roles(*, bot_token: str, guild_id: str) -> list[dict]:
    """GET /guilds/{guild_id}/roles -- complete role list, used by admin UI."""
    return await _request("GET", f"/guilds/{guild_id}/roles", bot_token=bot_token)


async def get_guild_member(
    *,
    bot_token: str,
    guild_id:  str,
    user_id:   str,
) -> dict:
    """GET /guilds/{guild_id}/members/{user_id} -- single member's roles."""
    return await _request(
        "GET", f"/guilds/{guild_id}/members/{user_id}", bot_token=bot_token,
    )


async def add_guild_member_role(
    *,
    bot_token: str,
    guild_id:  str,
    user_id:   str,
    role_id:   str,
) -> None:
    """PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}."""
    await _request(
        "PUT",
        f"/guilds/{guild_id}/members/{user_id}/roles/{role_id}",
        bot_token=bot_token,
    )


async def remove_guild_member_role(
    *,
    bot_token: str,
    guild_id:  str,
    user_id:   str,
    role_id:   str,
) -> None:
    """DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}."""
    await _request(
        "DELETE",
        f"/guilds/{guild_id}/members/{user_id}/roles/{role_id}",
        bot_token=bot_token,
    )


# ── Phase 3: bot interaction helpers ─────────────────────────────────────────
# All "guild moderation" actions go through the bot token: kick, ban, DM,
# bulk member listing.  The bot must be a member of the guild AND its role
# must sit ABOVE the target's highest role for moderation calls (kick / ban /
# add or remove a role) -- Discord 50013 ("Missing Permissions") otherwise.
# The route layer surfaces those errors verbatim so the admin UI can render
# the actual fix ("move the bot's role above @Member" instead of a vague
# "kick failed").

async def get_guild(*, bot_token: str, guild_id: str) -> dict:
    """
    GET /guilds/{guild_id}?with_counts=true

    Returns the guild snapshot (name, icon, owner, member counts) used by
    the admin Settings -> Discord page banner so the operator sees which
    server the bot is wired to without leaving the panel.
    """
    return await _request(
        "GET", f"/guilds/{guild_id}",
        query={"with_counts": "true"},
        bot_token=bot_token,
    )


async def list_guild_members(
    *,
    bot_token: str,
    guild_id:  str,
    limit:     int = 100,
    after:     Optional[str] = None,
) -> list[dict]:
    """
    GET /guilds/{guild_id}/members?limit=&after=

    Discord caps ``limit`` at 1000 per call; the admin UI pages with
    ``after=<last_user_id>`` to walk larger guilds.  Requires the
    GUILD_MEMBERS privileged intent enabled on the application + bot
    permission to read members; absence shows up as a 403 from Discord
    that the route layer turns into a friendly hint.
    """
    query: dict[str, Any] = {"limit": max(1, min(int(limit), 1000))}
    if after:
        query["after"] = str(after)
    return await _request(
        "GET", f"/guilds/{guild_id}/members",
        query=query, bot_token=bot_token,
    )


async def remove_guild_member(
    *,
    bot_token: str,
    guild_id:  str,
    user_id:   str,
) -> None:
    """
    DELETE /guilds/{guild_id}/members/{user_id} -- KICK the user.

    Discord uses the same verb for "kick" and "remove from guild".  The user
    can re-join via invite; use :func:`create_guild_ban` for a permanent
    block.
    """
    await _request(
        "DELETE", f"/guilds/{guild_id}/members/{user_id}",
        bot_token=bot_token,
    )


async def create_guild_ban(
    *,
    bot_token:                 str,
    guild_id:                  str,
    user_id:                   str,
    reason:                    Optional[str] = None,
    delete_message_seconds:    int = 0,
) -> None:
    """
    PUT /guilds/{guild_id}/bans/{user_id}

    ``delete_message_seconds`` (0..604800, i.e. up to 7 days) wipes the
    banned user's recent messages -- handy when banning a spammer.  The
    optional ``reason`` is recorded in the audit log.
    """
    body: dict[str, Any] = {
        "delete_message_seconds": max(0, min(int(delete_message_seconds), 604800)),
    }
    headers_extra: dict[str, str] = {}
    if reason:
        # Discord reads the audit-log reason from a header, not the body.
        headers_extra["X-Audit-Log-Reason"] = reason[:512]
    # Inline the call so we can attach the audit-log header without
    # threading another parameter through _request().
    url = f"{API_BASE}/guilds/{guild_id}/bans/{user_id}"
    headers = {
        "Accept":     "application/json",
        "User-Agent": "ArkManiaGest-Panel (https://arkmania.it, 1.0)",
        **_auth_header(bot_token=bot_token, bearer_token=None),
        **headers_extra,
    }
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        resp = await client.put(url, json=body, headers=headers)
    if resp.status_code in (200, 204):
        return
    try:
        error_body: Any = resp.json()
    except ValueError:
        error_body = resp.text
    raise DiscordAPIError(resp.status_code, error_body, method="PUT", url=url)


async def remove_guild_ban(
    *,
    bot_token: str,
    guild_id:  str,
    user_id:   str,
) -> None:
    """DELETE /guilds/{guild_id}/bans/{user_id} -- UNBAN the user."""
    await _request(
        "DELETE", f"/guilds/{guild_id}/bans/{user_id}",
        bot_token=bot_token,
    )


async def create_dm_channel(*, bot_token: str, recipient_id: str) -> dict:
    """
    POST /users/@me/channels -- open (or fetch) a DM channel with a user.

    Discord caches DM channels per recipient: calling repeatedly returns
    the same channel id, so we don't bother caching this in the panel
    (Discord already does it for us).  Returns the channel envelope
    (the ``id`` is what :func:`send_message` needs).
    """
    return await _request(
        "POST", "/users/@me/channels",
        json_body={"recipient_id": str(recipient_id)},
        bot_token=bot_token,
    )


async def send_message(
    *,
    bot_token: str,
    channel_id: str,
    content:    str,
) -> dict:
    """
    POST /channels/{channel_id}/messages -- send a plain-text message.

    Used by the admin UI to DM a player: open DM via
    :func:`create_dm_channel`, then call this with the returned channel id.
    The 2 000-char Discord ceiling is enforced in the route layer.
    """
    return await _request(
        "POST", f"/channels/{channel_id}/messages",
        json_body={"content": content},
        bot_token=bot_token,
    )
