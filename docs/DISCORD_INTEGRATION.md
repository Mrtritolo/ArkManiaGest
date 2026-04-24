# Discord integration roadmap

This document tracks the multi-phase rollout of the Discord OAuth /
account linking / role-sync feature set.  It is the contract between
the user (product owner) and the implementation work; each phase
should land as a self-contained PR with its own version bump.

The work is intentionally split so partial deployment is safe: each
phase below can ship to production on its own and gives operators a
useful subset of the final functionality.

---

## Goals

1. **Discord OAuth2 login** — users can sign into the panel with their
   Discord account (Authorization Code grant).
2. **Account linking** — an authenticated Discord user can be linked
   1:1 to an existing player record (matched by EOS ID) so the panel
   knows "Discord user X = player Y".
3. **Bidirectional role sync** — admins can map application roles to
   Discord roles and:
   * push panel-side role changes out to the Discord guild;
   * pull Discord-side role changes in to refresh panel permissions.
4. **Per-user dashboard** — the player-facing UI shows linking status,
   active roles, unlocked perks, and a one-click unlink/relink.

## Non-functional requirements

* Robust error handling (no silent 500 — see the global exception
  handler added in this same hardening commit).
* Structured logging for both auth and sync events (audit trail).
* Token storage encrypted with AES-256-GCM (reuse `core.encryption`).
* Rate-limit aware HTTP client for the Discord API
  (`X-RateLimit-Remaining` / `Retry-After`).

---

## Phased plan

Each phase is sized so it can ship as one tagged release.  Numbers in
brackets are the working estimate for implementation + smoke test.

### Phase 0 — Hardening (DONE in 2.3.10-dev)

* Global FastAPI exception handler that returns JSON `{detail}` for
  every unhandled exception (replaces the empty 500).
* `system-update/install` wraps both `preflight()` and
  `run_self_update_async()` in try/except, persisting tracebacks to
  `/tmp/arkmaniagest-update-status.json` and to the live log file so
  the UI's status drawer always shows what failed.
* New `self_updater.write_failure_status()` helper.

This unblocks the immediate v2.3.8 -> v2.3.9 self-update bug: the
next time an unhandled exception fires, the UI will display its
class name + message and the operator can ssh in to read the full
traceback from `/var/log/arkmaniagest/backend-error.log`.

### Phase 1 — Foundations  (1-2 days)

Database, config, dependency.

* New panel-DB tables (panel-side, NOT plugin-side):
  * `arkmaniagest_discord_accounts`
    * `id` (pk)
    * `discord_user_id` (unique)
    * `discord_username` / `discord_global_name` / `discord_avatar`
    * `eos_id` (foreign-key-ish reference to Players.EOS_Id; unique
      so the linking is 1:1 in both directions)
    * `access_token_enc`  (AES-GCM, refreshed on demand)
    * `refresh_token_enc` (AES-GCM)
    * `token_expires_at` (datetime)
    * `linked_at` / `linked_by_user_id`
    * `last_sync_at`
  * `arkmaniagest_discord_role_map`
    * `id`
    * `app_role_name` (str — references PermissionGroups.GroupName)
    * `discord_guild_id` (str)
    * `discord_role_id`  (str)
    * `direction` (`both` | `panel_to_discord` | `discord_to_panel`)
    * `priority` (int — for conflict resolution)
* `.env` additions:
  * `DISCORD_CLIENT_ID`
  * `DISCORD_CLIENT_SECRET`
  * `DISCORD_BOT_TOKEN`     (server-side bot used for guild calls)
  * `DISCORD_GUILD_ID`
  * `DISCORD_REDIRECT_URI`  (e.g. `https://gestionale.arkmania.it/auth/discord/callback`)
* New dep: `httpx` already present, `authlib` for OAuth helpers
  (or a hand-rolled minimal flow using stdlib + `httpx` to keep the
  dependency set lean).
* Config validators: empty CLIENT_ID/SECRET means the Discord routes
  return 503 with a clear "configure Discord first" hint instead of
  blowing up at import time.

### Phase 2 — OAuth2 sign-in  (1-2 days)

Auth flow only — no linking yet.

* `GET  /api/v1/auth/discord/start`
  Builds the Discord authorize URL (state + PKCE) and returns the
  URL for the frontend to redirect to.
* `GET  /api/v1/auth/discord/callback?code=&state=`
  Exchanges the code for tokens, fetches `/users/@me`, stores the
  Discord profile (no panel-user link yet), drops a session cookie
  identifying the Discord identity.
* `GET  /api/v1/auth/discord/me`
  Returns the current Discord identity if authed, else 401.
* Frontend: "Sign in with Discord" button on the Login page next to
  the username/password form.
* Backend test: integration test that mocks the Discord token + user
  endpoints with `respx`.

### Phase 3 — Account linking  (1 day)

Connect Discord identity to an existing player.

* `GET  /api/v1/discord/players/search?eos_id=&name=`
  Search players by EOS ID prefix or display name (admin only when
  searching arbitrary players; self-link uses the player's own
  EOS ID and doesn't need admin).
* `POST /api/v1/discord/link`
  body: `{ player_id: int }`
  Body player_id refers to `Players.Id`; the route asserts the
  authenticated Discord identity is allowed to link to that player
  (operator confirms linking in panel for now; OAuth-tied EOS
  Account API verification is a future enhancement).
* `DELETE /api/v1/discord/link`
  Self-unlink.
* `DELETE /api/v1/discord/link/{discord_user_id}` (admin)
  Force-unlink for support.
* Frontend: dashboard card showing link status + a search-and-pick
  modal for players.

### Phase 4 — Role mapping CRUD  (1 day)

Admin UI for the mapping table only — no sync yet.

* `GET  /api/v1/discord/role-mappings`
* `POST /api/v1/discord/role-mappings`
* `PUT  /api/v1/discord/role-mappings/{id}`
* `DELETE /api/v1/discord/role-mappings/{id}`
* `GET  /api/v1/discord/guild/roles`
  Server-side proxy that fetches the guild's role list via the bot
  token (so admins picking a Discord role get a dropdown of real
  roles instead of typing IDs).
* Frontend: Settings -> "Discord roles" page with a CRUD table.

### Phase 5 — Sync engine  (2-3 days)

The actual bidirectional reconciliation.

* `POST /api/v1/discord/sync/run`
  Manual trigger; runs the full reconciliation and returns a
  summary (added / removed / conflicts).
* Background scheduler: cron + APScheduler (already imported by
  the panel) runs the same reconciliation every N minutes (config).
* `GET  /api/v1/discord/sync/log`
  Audit log of every sync run + each individual role grant/revoke.
* Reconciliation rules (per linked player, per mapping row):
  * `panel_to_discord`: if the player has the app role in
    `Players.PermissionGroups`, ensure they have the Discord role;
    if they don't, ensure they don't.
  * `discord_to_panel`: if the player has the Discord role, ensure
    the app role is in `Players.PermissionGroups`; if not, ensure
    it's removed.
  * `both`: union semantics; conflict resolution via `priority` --
    higher-priority side wins on disagreement.
* Frontend: Settings -> "Discord roles" page gains a "Force sync"
  button and a recent-runs panel.

### Phase 6 — Per-user dashboard  (1 day)

Player-facing view.

* `GET  /api/v1/discord/me/dashboard`
  Returns: link status, linked player record, active app roles,
  active Discord roles (filtered to the mapped ones), unlocked perks
  (TBD: e.g. "+10% shop discount" if the user has the Patreon role).
* Frontend: new `/discord` route in the sidebar (player-facing).
  Three cards: connection status, active roles, perks.

### Phase 7 — Webhook / push events (optional, later)

Skip the polling worker for changes that come from Discord by
subscribing to Discord's gateway events via the bot:

* `GUILD_MEMBER_UPDATE` -> trigger a single-user sync for the
  affected user.
* `GUILD_MEMBER_REMOVE` -> mark the link as stale and unlink.

This needs a long-lived gateway connection (websocket) which is a
bigger architectural change; the polling design from Phase 5 stays
the source of truth even after this lands.

---

## Operational notes

* **Discord application registration** is a one-time manual step:
  https://discord.com/developers/applications -> New Application ->
  OAuth2 (set redirect to the panel URL) -> Bot tab -> add bot to
  the guild with the `manage_roles` permission.  All the IDs and
  secrets go in `backend/.env`.
* **Token storage**: every Discord OAuth token sits in the panel DB
  encrypted with the existing `FIELD_ENCRYPTION_KEY` (AES-256-GCM),
  same as SSH passwords today.
* **CORS / cookies**: the Discord OAuth callback lives under the
  same origin as the panel (no cross-origin), so we don't need any
  CORS gymnastics.  The session cookie carrying the Discord identity
  must be `Secure`, `HttpOnly`, `SameSite=Lax`.
* **Failure modes** explicitly handled (so the global handler isn't
  the line of last defence):
  * Discord 401 on bot token -> "configure DISCORD_BOT_TOKEN".
  * Discord 403 on guild call -> bot missing the `manage_roles`
    permission.
  * Discord 429 -> retry once after `Retry-After`, then surface to
    the operator with the reset time.
  * Player record deleted while linked -> sync run drops the link
    and writes an audit row.

---

## Acceptance criteria per phase

Each phase is "done" when:
* All endpoints respond as documented (see backend tests).
* The UI piece for that phase is wired and i18n'd in EN + IT.
* `CHANGELOG.md` has a section describing what shipped and any
  `.env` keys the operator must add.
* The release tag is pushed.

---

## Out of scope (for now)

* SSO via other providers (Google, GitHub, ...).  The hooks added
  here are Discord-specific; generalising to a multi-provider
  abstraction is a separate ticket.
* Migrating the panel's existing username/password auth onto OAuth.
  Discord login is ADDITIVE — admins can still sign in with the
  built-in account.
* In-Discord slash commands ("link my account from Discord").  The
  current scope assumes the user starts the linking from the panel
  UI.
