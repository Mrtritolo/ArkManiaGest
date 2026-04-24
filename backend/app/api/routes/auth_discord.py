"""
api/routes/auth_discord.py — Discord OAuth2 sign-in (Phase 2).

Three endpoints:

  GET  /auth/discord/start
       Returns the Discord authorize URL for the frontend to redirect to.
       Issues a short-lived signed cookie (`disc_oauth_state`) carrying
       the random `state` so the callback can verify it without a
       server-side store.

  GET  /auth/discord/callback?code=&state=
       Exchanges the OAuth code for tokens, fetches the user's
       Discord profile, persists the account, sets the
       `disc_session` cookie identifying the Discord identity for
       this browser tab.  Then redirects the browser back to the
       SPA root with `?discord_login=ok` (or `?discord_login=err`).

  POST /auth/discord/logout
       Clears the disc_session cookie.

The Discord session cookie is INDEPENDENT from the panel-user JWT --
this Phase 2 only authenticates the Discord identity.  Phase 3 adds
the player-link step on top, and only the linked combination grants
real panel access.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import _get_jwt_secret as _jwt_secret, create_token
from app.core.config import server_settings
from app.db.models.app import AppUser
from app.db.session import get_db
from app.discord import client as dc_client
from app.discord import store as dc_store
from app.discord.config import get_discord_config


router = APIRouter()
log = logging.getLogger("arkmaniagest.discord.auth")

_AUTHORIZE_URL = "https://discord.com/oauth2/authorize"

# OAuth scopes we request.  `identify` -> /users/@me; `email` is omitted
# on purpose (we don't need the email and asking for it would force the
# user into a wider Discord consent screen).  Future phases may ask for
# `guilds.members.read` once we want client-side guild reads.
_SCOPES = "identify"

# Cookie names + lifetimes
_STATE_COOKIE       = "disc_oauth_state"
_STATE_COOKIE_TTL_S = 600                 # 10 min for the round-trip
_SESSION_COOKIE     = "disc_session"
_SESSION_TTL_HOURS  = 24

# JWT custom audiences -- separate the two cookie types so a stolen
# state token can't ever be replayed as a session token.
_AUD_STATE   = "discord-oauth-state"
_AUD_SESSION = "discord-session"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _sign_jwt(payload: dict, *, audience: str, ttl_seconds: int) -> str:
    secret = _jwt_secret()
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            **payload,
            "aud": audience,
            "iat": now,
            "exp": now + timedelta(seconds=ttl_seconds),
        },
        secret,
        algorithm="HS256",
    )


def _verify_jwt(token: str, *, audience: str) -> dict:
    secret = _jwt_secret()
    return jwt.decode(token, secret, algorithms=["HS256"], audience=audience)


def _require_oauth_ready():
    cfg = get_discord_config()
    missing = cfg.missing_for_oauth()
    if missing:
        raise HTTPException(
            status_code=503,
            detail=(
                "Discord OAuth not configured.  Missing .env keys: "
                + ", ".join(missing)
            ),
        )
    return cfg


# ── Route 1: start ───────────────────────────────────────────────────────────

class _StartResponse(BaseModel):
    authorize_url: str


@router.get("/auth/discord/start", response_model=_StartResponse)
def start_discord_oauth(
    response:  Response,
    next_path: str = Query(default="/", max_length=200,
                           description="SPA path to land on after callback."),
):
    """
    Build the Discord authorize URL + drop a signed state cookie.

    The frontend just calls this, then `window.location = response.authorize_url`.
    """
    cfg = _require_oauth_ready()

    # Random nonce -> embedded in BOTH the cookie and the URL `state` param.
    # On callback the two must match (CSRF protection).
    nonce = secrets.token_urlsafe(24)
    state_token = _sign_jwt(
        {"nonce": nonce, "next": next_path},
        audience=_AUD_STATE,
        ttl_seconds=_STATE_COOKIE_TTL_S,
    )

    response.set_cookie(
        key=_STATE_COOKIE,
        value=state_token,
        max_age=_STATE_COOKIE_TTL_S,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )

    params = {
        "client_id":     cfg.client_id,
        "redirect_uri":  cfg.redirect_uri,
        "response_type": "code",
        "scope":         _SCOPES,
        "state":         nonce,
        "prompt":        "consent",
    }
    return _StartResponse(authorize_url=f"{_AUTHORIZE_URL}?{urlencode(params)}")


# ── Route 2: callback ────────────────────────────────────────────────────────

@router.get("/auth/discord/callback")
async def discord_oauth_callback(
    request: Request,
    code:    Optional[str] = Query(default=None),
    state:   Optional[str] = Query(default=None),
    error:   Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
    state_cookie: Optional[str] = Cookie(default=None, alias=_STATE_COOKIE),
    db:      AsyncSession = Depends(get_db),
):
    """
    Discord redirects the browser here after the user approves (or
    rejects) the consent screen.  We:

      1. Validate the signed state cookie matches the `state` query param.
      2. Exchange `code` for OAuth tokens.
      3. Fetch the user's profile.
      4. Upsert the discord_account row + set the session cookie.
      5. 302 the browser back to the SPA root with a status flag.

    Any failure produces a 302 to `/?discord_login=err&reason=...` so
    the SPA can show a user-friendly toast; we never 500 here because
    the user is mid-redirect-flow and a JSON error wouldn't be shown.
    """
    cfg = _require_oauth_ready()

    def _redirect(
        ok:        bool,
        reason:    str = "",
        next_path: str = "/",
        *,
        panel_jwt: Optional[str] = None,
    ) -> RedirectResponse:
        # Strip any leading scheme/host the user might have injected --
        # only relative paths inside the SPA are allowed as next.
        safe_next = next_path if next_path.startswith("/") else "/"
        params = {"discord_login": "ok" if ok else "err"}
        if reason:
            params["reason"] = reason[:200]
        sep = "&" if "?" in safe_next else "?"
        target = safe_next + sep + urlencode(params)
        # Attach the panel JWT via the URL fragment (#token=...) so it
        # never lands in server logs (web servers don't see fragments).
        # The SPA reads it on load and immediately scrubs it via
        # history.replaceState.
        if panel_jwt:
            target = target + "#token=" + panel_jwt
        resp = RedirectResponse(url=target, status_code=302)
        # Always clear the state cookie -- single-use.
        resp.delete_cookie(_STATE_COOKIE, path="/")
        return resp

    # Discord redirects back with ?error=access_denied when the user
    # clicks "Cancel" on the consent screen.
    if error:
        log.info("Discord OAuth user-side error: %s (%s)", error, error_description)
        return _redirect(False, reason=f"discord_error:{error}")

    if not code or not state:
        return _redirect(False, reason="missing_code_or_state")

    if not state_cookie:
        return _redirect(False, reason="missing_state_cookie")
    try:
        state_payload = _verify_jwt(state_cookie, audience=_AUD_STATE)
    except jwt.ExpiredSignatureError:
        return _redirect(False, reason="state_expired")
    except jwt.InvalidTokenError:
        return _redirect(False, reason="state_invalid")

    if state_payload.get("nonce") != state:
        return _redirect(False, reason="state_mismatch")
    next_path = str(state_payload.get("next") or "/")

    # ── Exchange code -> tokens ───────────────────────────────────────────
    try:
        token_resp = await dc_client.exchange_code(
            client_id=cfg.client_id,
            client_secret=cfg.client_secret,
            code=code,
            redirect_uri=cfg.redirect_uri,
        )
    except dc_client.DiscordAPIError as exc:
        log.warning("Discord token exchange failed: %s", exc)
        return _redirect(False, reason="token_exchange_failed", next_path=next_path)
    except Exception as exc:                            # noqa: BLE001
        log.exception("Discord token exchange raised: %s", exc)
        return _redirect(False, reason="token_exchange_crash", next_path=next_path)

    access_token  = token_resp.get("access_token")
    refresh_token = token_resp.get("refresh_token")
    expires_in    = int(token_resp.get("expires_in") or 0)
    scope         = token_resp.get("scope")
    if not access_token:
        return _redirect(False, reason="no_access_token", next_path=next_path)

    # ── Fetch user profile ────────────────────────────────────────────────
    try:
        profile = await dc_client.get_current_user(bearer_token=access_token)
    except dc_client.DiscordAPIError as exc:
        log.warning("Discord /users/@me failed: %s", exc)
        return _redirect(False, reason="profile_fetch_failed", next_path=next_path)
    except Exception as exc:                            # noqa: BLE001
        log.exception("Discord /users/@me raised: %s", exc)
        return _redirect(False, reason="profile_fetch_crash", next_path=next_path)

    discord_user_id = str(profile.get("id") or "")
    if not discord_user_id:
        return _redirect(False, reason="no_user_id", next_path=next_path)

    # ── Persist + set session cookie ──────────────────────────────────────
    try:
        await dc_store.upsert_discord_identity(
            db,
            discord_user_id=discord_user_id,
            discord_username=profile.get("username"),
            discord_global_name=profile.get("global_name"),
            discord_avatar=profile.get("avatar"),
            access_token=access_token,
            refresh_token=refresh_token or "",
            expires_in=expires_in,
            scope=scope,
        )
    except Exception as exc:                            # noqa: BLE001
        log.exception("Discord upsert failed: %s", exc)
        return _redirect(False, reason="persist_failed", next_path=next_path)

    session_token = _sign_jwt(
        {"discord_user_id": discord_user_id},
        audience=_AUD_SESSION,
        ttl_seconds=_SESSION_TTL_HOURS * 3600,
    )

    # ── Resolve panel access (admin / operator / viewer) ────────────────
    # Two precedence rules, highest first:
    #   1. The Discord identity is BOUND to a panel AppUser (via the
    #      admin-set discord_accounts.app_user_id link) -> issue a JWT
    #      for that AppUser, role = whatever the AppUser already has.
    #   2. The Discord user_id is in DISCORD_{ADMIN,OPERATOR,VIEWER}_USER_IDS
    #      whitelist -> upsert a stub `discord:<id>` AppUser if needed,
    #      then issue a JWT for that role.
    # If neither matches, the OAuth identity is "logged in to Discord
    # but not yet authorised on the panel" -- the SPA can still pick
    # up the disc_session cookie and walk the player-link flow that
    # Phase 3 ships.
    panel_jwt: Optional[str] = None
    try:
        panel_jwt = await _maybe_issue_panel_jwt(
            db,
            discord_user_id=discord_user_id,
            discord_global_name=profile.get("global_name") or profile.get("username"),
        )
    except Exception as exc:                            # noqa: BLE001
        log.exception("Discord panel-JWT resolution failed: %s", exc)
        # Don't block the login -- the user still has the disc_session
        # cookie and can do player-side things in Phase 3.

    # When we DO have a panel JWT we deliver it via the URL fragment
    # (#token=...) rather than a query param so:
    #   * web-server access logs DON'T capture the token (fragments are
    #     never sent to the server in subsequent navigation),
    #   * a casual screen-share / shoulder-surf doesn't expose it,
    #   * the SPA reads it on load and immediately calls
    #     window.history.replaceState to scrub the URL.
    resp = _redirect(True, next_path=next_path, panel_jwt=panel_jwt)
    resp.set_cookie(
        key=_SESSION_COOKIE,
        value=session_token,
        max_age=_SESSION_TTL_HOURS * 3600,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )
    return resp


# ── panel JWT resolver --------------------------------------------------------

def _csv_set(raw: str) -> set[str]:
    """Parse a comma-separated env value into a stripped set."""
    return {item.strip() for item in (raw or "").split(",") if item.strip()}


async def _maybe_issue_panel_jwt(
    db:                    AsyncSession,
    *,
    discord_user_id:       str,
    discord_global_name:   Optional[str],
) -> Optional[str]:
    """
    Resolve which panel AppUser (if any) this Discord identity should
    log in as, and return a fresh JWT for that user.  Returns None
    when the Discord identity has no admin / operator / viewer claim.
    """
    # 1. Admin-set link wins (a real AppUser already exists).
    row = await dc_store.get_by_discord_id(db, discord_user_id)
    app_user_id = row.get("app_user_id") if row else None
    if app_user_id:
        u = await db.scalar(select(AppUser).where(AppUser.id == app_user_id))
        if u and (u.active if u.active is not None else True):
            return create_token(u.username, u.role)

    # 2. Whitelist fallback -- upsert a stub discord:<id> user.
    cfg = server_settings
    admins    = _csv_set(cfg.DISCORD_ADMIN_USER_IDS)
    operators = _csv_set(cfg.DISCORD_OPERATOR_USER_IDS)
    viewers   = _csv_set(cfg.DISCORD_VIEWER_USER_IDS)

    role: Optional[str] = None
    if discord_user_id in admins:    role = "admin"
    elif discord_user_id in operators: role = "operator"
    elif discord_user_id in viewers:   role = "viewer"
    if not role:
        return None

    # Username convention: discord:<id> -- can never collide with a
    # real human-typed username because ":" isn't allowed in our
    # password-account creation form.  display_name is the Discord
    # name so the sidebar shows something readable.
    username = f"discord:{discord_user_id}"
    existing = await db.scalar(select(AppUser).where(AppUser.username == username))
    if existing:
        # Refresh role + display_name in case the whitelist or the
        # Discord profile changed since last login.
        existing.role         = role
        existing.display_name = discord_global_name or existing.display_name or username
        existing.active       = True
    else:
        from app.core.auth import hash_password as _hash
        import secrets as _secrets
        existing = AppUser(
            username     = username,
            password_hash= _hash(_secrets.token_urlsafe(48)),  # unusable
            role         = role,
            display_name = discord_global_name or username,
            active       = True,
        )
        db.add(existing)
    await db.commit()
    await db.refresh(existing)
    # Bind the Discord account to this AppUser so future logins skip
    # the whitelist branch entirely (Step 1 will catch them).
    await dc_store.set_app_user_link(
        db, discord_user_id=discord_user_id, app_user_id=existing.id,
    )
    return create_token(existing.username, existing.role)


# ── Route 3: /me + logout ────────────────────────────────────────────────────

class _MeResponse(BaseModel):
    discord_user_id:     str
    discord_username:    Optional[str] = None
    discord_global_name: Optional[str] = None
    discord_avatar:      Optional[str] = None
    eos_id:              Optional[str] = None
    linked_at:           Optional[str] = None


def _read_session_cookie(disc_session: Optional[str]) -> Optional[str]:
    """Decode the disc_session cookie and return the discord_user_id."""
    if not disc_session:
        return None
    try:
        payload = _verify_jwt(disc_session, audience=_AUD_SESSION)
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None
    return payload.get("discord_user_id")


@router.get("/auth/discord/me", response_model=_MeResponse)
async def get_discord_session(
    disc_session: Optional[str] = Cookie(default=None, alias=_SESSION_COOKIE),
    db:           AsyncSession  = Depends(get_db),
):
    """Return the Discord identity for the current browser session, or 401."""
    discord_user_id = _read_session_cookie(disc_session)
    if not discord_user_id:
        raise HTTPException(status_code=401, detail="No Discord session.")
    row = await dc_store.get_by_discord_id(db, discord_user_id)
    if not row:
        # Cookie referenced a row that's gone -- treat as logged out.
        raise HTTPException(status_code=401, detail="Discord session orphaned.")
    return _MeResponse(
        discord_user_id     = row["discord_user_id"],
        discord_username    = row.get("discord_username"),
        discord_global_name = row.get("discord_global_name"),
        discord_avatar      = row.get("discord_avatar"),
        eos_id              = row.get("eos_id"),
        linked_at           = row.get("linked_at"),
    )


@router.post("/auth/discord/logout")
def discord_logout():
    """Clear the disc_session cookie."""
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(_SESSION_COOKIE, path="/")
    return resp
