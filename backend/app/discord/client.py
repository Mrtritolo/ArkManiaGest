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
