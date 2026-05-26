# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# ArkManiaGest — Project-Specific Guidance

Admin panel for ARK: Survival Ascended clusters. Read [README.md](README.md)
and [CONTRIBUTING.md](CONTRIBUTING.md) before larger changes.

## Stack at a glance

| Layer | Tech | Source of truth |
|-------|------|-----------------|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2 (async aiomysql + sync pymysql), Paramiko, cryptography | [backend/requirements.txt](backend/requirements.txt) |
| Frontend | React 18 + TypeScript + Vite, react-i18next, Lucide, custom CSS | [frontend/package.json](frontend/package.json) |
| Database | MariaDB 10.6+, **two distinct connections** (panel + plugin) | [backend/app/db/session.py](backend/app/db/session.py) |
| Deploy | Bash + PowerShell scripts, Nginx, systemd, Let's Encrypt | [deploy/](deploy/) |

Current version: **4.0.0** (see [backend/app/main.py:115](backend/app/main.py:115) and
[frontend/package.json:4](frontend/package.json:4) — keep them in sync).

## Repository layout (essentials)

```
backend/app/
├── api/routes/         # One module per FastAPI router; aggregated in routes/__init__.py
├── core/               # auth (JWT/bcrypt), encryption (AES-256-GCM), config (.env), security middleware, store
├── db/
│   ├── models/app.py   # Panel ORM tables (arkmaniagest_*, ARKM_server_instances, ARKM_blueprints, …)
│   └── models/ark.py   # Plugin ORM tables (Players, ArkShop*, ARKM_bans, …) — NEVER auto-created
│   └── session.py      # init_engine / init_plugin_engine, get_db / get_plugin_db, in-place migrations
├── schemas/            # Pydantic request/response models
├── services/           # Cross-cutting helpers (self_updater, market_thumbs, cryopod_parser)
├── ssh/                # Paramiko/SCP manager, scanner, profile parser, PlatformAdapter (linux/windows+WSL)
├── discord/            # Discord OAuth + bot client + role/VIP sync
└── main.py             # FastAPI app entry, lifespan, middleware, global exception handler
frontend/src/
├── App.tsx             # Auth state machine + router
├── pages/              # One TSX file per page; admin pages + PlayerDashboard + Market
├── components/         # Sidebar, StatusBadge, DiscordIcon
├── services/api.ts     # The ONLY axios client — domain-grouped objects (authApi, machinesApi, …)
├── i18n/               # react-i18next bootstrap + en.json / it.json bundled inline
├── types/index.ts      # Shared TypeScript types
└── theme.ts            # Light/dark theme switcher (data-theme on <html>)
deploy/
├── install-panel.{ps1,sh}   # First install
├── update-{remote,panel}.{ps1,sh}, server-update.sh
├── migrations/NNN_*.sql     # Idempotent ALTER TABLE migrations
└── full-deploy.sh, setup-ssl.sh, setup-cron.sh, backup.sh, restore.sh, test_db.py
docs/                   # INSTALL.{en,it}.md, DISCORD_INTEGRATION.md, MARKETPLACE_API_CONTRACT.md
reference/              # POK-manager checkout — gitignored, used as a template source
```

## Non-negotiable rules

### Two databases, never confuse them
- **Panel DB** (`get_db` / `get_panel_db`) holds `arkmaniagest_*` tables and the
  three panel-owned `ARKM_*` tables: `ARKM_server_instances`,
  `ARKM_instance_actions`, `ARKM_mariadb_instances`, plus `ARKM_blueprints`.
- **Plugin DB** (`get_plugin_db`) holds the game-plugin tables (`ARKM_config`,
  `ARKM_bans`, `ARKM_rare_dinos`, `ARKM_lb_*`, `ARKM_decay_*`, `ARKM_market_*`,
  …) and native ARK tables (`Players`, `ArkShopPlayers`, `PermissionGroups`,
  `TribePermissions`).
- Pick the right dependency per route. **Never call `Base.metadata.create_all`
  on plugin tables** — they are owned by the game plugins; only the explicit
  filter in `create_app_tables()` is allowed.
- Marketplace tables are an exception: panel-owned at boot
  (`create_marketplace_tables`), but written by both plugin and panel — see
  [docs/MARKETPLACE_API_CONTRACT.md](docs/MARKETPLACE_API_CONTRACT.md).

### Schema changes
- Add the new column / table to [backend/app/db/models/app.py](backend/app/db/models/app.py).
- Add an idempotent migration at `deploy/migrations/NNN_short_description.sql`
  (next free number — see [deploy/migrations/](deploy/migrations/)).
- For tiny in-place column adds, use `_add_column_if_missing` /
  `_relax_column_to_null` inside `create_app_tables()` so existing installs
  upgrade on boot without operator action.
- `create_all()` never ALTERs an existing table — never assume it will.

### Secrets and encryption
- AES-256-GCM via [backend/app/core/encryption.py](backend/app/core/encryption.py)
  is the **only** way sensitive fields hit the DB. Columns end in `_enc` and
  are stored as base64(nonce ‖ ciphertext ‖ tag).
- This applies to: SSH passwords/passphrases, ASA admin/server passwords,
  managed-MariaDB root passwords, Discord client secret + bot token.
- Never log decrypted credentials. Read endpoints never return them.
- `JWT_SECRET` and `FIELD_ENCRYPTION_KEY` are auto-generated to `.env` on first
  boot by `ServerSettings.ensure_secrets()` — do not check them into the repo
  or hardcode them.

### Authentication boundaries
- The default for any new route is **JWT-protected with `require_viewer`**, applied
  at the router level in [backend/app/api/routes/\_\_init\_\_.py](backend/app/api/routes/__init__.py).
- Public exceptions (no JWT): `auth.*`, `auth_discord.*`, `me.*`,
  `market.*` (mixed auth), `settings.*`, `public.*`. Handlers in `me`/`market`
  validate the Discord session cookie or admin JWT inside the handler — do not
  add a router-level guard there.
- Admin-only routes (`system_update`, `discord`, `sql_console`) keep the
  `require_viewer` router dep and add an explicit admin check inside each
  handler. Match this pattern, don't invent a new one.
- Frontend stores the JWT in `sessionStorage` only (`arkmaniagest.authToken`).
  Never push it to `localStorage` — see the deliberate comment in
  [frontend/src/services/api.ts](frontend/src/services/api.ts).

### Frontend conventions
- Functional components + hooks only.
- **All UI text goes through `useTranslation()`** and is added to **both**
  `frontend/src/i18n/locales/en.json` and `it.json` in the same change. Never
  one without the other.
- **All HTTP calls go through `services/api.ts`.** Don't import `axios`
  directly from a page or component.
- Styles live in `index.css` with CSS variables. We don't use Tailwind utility
  classes in components, even though `tailwindcss` is listed in
  `devDependencies` (legacy). Use the existing variables — and for floating
  popovers/modals, **`var(--bg-popover)`**, not `var(--bg-card)` (the latter
  is translucent and unreadable on dark mode — see the 3.5.5 fix).
- Light/dark theme is driven by `[data-theme]` on `<html>`; persisted in
  `localStorage` under `arkmaniagest.theme`.

### SSH / cross-platform hosts
- All remote calls go through `app/ssh/manager.py` (`SSHManager`) +
  `app/ssh/platform.py` (`PlatformAdapter`).
- A host's `os_type` is `"linux"` or `"windows"`. Windows hosts run
  POK-manager / Docker through `wsl.exe` — never call bash/POK-manager
  directly assuming a Linux host. Use the adapter.
- SSH credentials are read via `app/core/store.py`, which decrypts `*_enc`
  columns transparently.

### Deploy scripts
- Bash targets Ubuntu/Debian; PowerShell targets **Windows PowerShell 5.1**
  (the version that ships with Windows). Avoid PowerShell 7-only syntax in
  installer scripts.
- Every script must be **idempotent** — re-running on the same target is the
  primary upgrade path.
- Run `bash -n script.sh` before committing shell changes.
- Never commit real IPs, hostnames, or secrets. Templates use placeholders;
  keep `deploy/deploy.conf.example` sanitised.

### Versioning
- Version string lives in **three** places — keep them in lockstep:
  - [backend/app/main.py](backend/app/main.py) (`FastAPI(version=...)` and the
    `/health` payload)
  - [frontend/package.json](frontend/package.json) (`version`)
  - [CHANGELOG.md](CHANGELOG.md) entry
- Hand-written release notes go in `next-release-notes.md` (gitignored), are
  consumed by the release tooling, then deleted. The canonical record is
  CHANGELOG.md.

### Language conventions
- **Code, comments, docstrings, commit messages, PR descriptions: English.**
- **User-facing UI strings: localised via i18n (IT + EN).**
- Conversational replies to the maintainer in this repo can be Italian — but
  anything that lands in a file follows the rules above.

## Common pitfalls (don't repeat them)

- **Don't bypass `services/api.ts`** with a one-off `fetch`/`axios` import.
- **Don't add a UI string in only one locale.** The other locale will silently
  fall back to English at runtime, but the operator using IT sees a missing
  translation. Add to both files in the same diff.
- **Don't write to plaintext columns when an `_enc` column exists.** Always
  go through `encrypt_value` and the `store` helpers.
- **Don't auto-create plugin tables.** `create_app_tables()` filters strictly
  on `app_models.__name__`; preserve that filter.
- **Don't assume single-DB.** `plugin_db_is_separate` exists for a reason; read
  state from `get_plugin_db` if it logically belongs to the plugin DB, even
  when the operator hasn't split the databases yet.
- **Don't hardcode the panel address / domain / admin IP** anywhere — the
  operator-supplied values flow through `.env` and `deploy.conf`.
- **`var(--bg-card)` for floating overlays is a known footgun.** Use
  `--bg-popover` (and the `--surface` / `--text` aliases) instead.
- **POK-manager is in `reference/` (gitignored).** Treat it as read-only
  template source; never patch it from this repo.

## Where to look first

| Question | File |
|---|---|
| How does the FastAPI app boot? | [backend/app/main.py](backend/app/main.py) |
| Which routes exist and how are they protected? | [backend/app/api/routes/\_\_init\_\_.py](backend/app/api/routes/__init__.py) |
| What's the panel schema? | [backend/app/db/models/app.py](backend/app/db/models/app.py) |
| What's the plugin schema? | [backend/app/db/models/ark.py](backend/app/db/models/ark.py) |
| How are the two engines wired? | [backend/app/db/session.py](backend/app/db/session.py) |
| How does encryption work? | [backend/app/core/encryption.py](backend/app/core/encryption.py) |
| How do middlewares + rate limiting work? | [backend/app/core/security.py](backend/app/core/security.py) |
| How does the auth state machine work? | [frontend/src/App.tsx](frontend/src/App.tsx) |
| Available API client methods? | [frontend/src/services/api.ts](frontend/src/services/api.ts) |
| How to deploy / update an install? | [deploy/](deploy/), [docs/INSTALL.en.md](docs/INSTALL.en.md) |
| Marketplace ownership matrix? | [docs/MARKETPLACE_API_CONTRACT.md](docs/MARKETPLACE_API_CONTRACT.md) |
| Discord rollout plan? | [docs/DISCORD_INTEGRATION.md](docs/DISCORD_INTEGRATION.md) |
