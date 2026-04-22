# Changelog

All notable changes to ArkManiaGest are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).

---

## [2.3.5] - 2026-04-22

### Added

- **In-UI self-update** (Settings -> General -> Updates card, new
  "Install update" button).  When a newer release is available on
  GitHub, an admin can now install it directly from the browser:
  - `GET  /api/v1/system-update/preflight` -- reports whether the
    sudoers entry, `server-update.sh` and `GITHUB_REPO` are in place;
    the UI uses it to enable/disable the button and explain what is
    missing.
  - `POST /api/v1/system-update/install` -- fetches the latest GitHub
    release metadata, downloads the Linux tarball to `/tmp`, verifies
    its SHA-256 against `SHA256SUMS`, then spawns `server-update.sh`
    in a detached process (`start_new_session=True`) so it survives
    the backend restart it triggers.
  - `GET  /api/v1/system-update/status` -- poll-friendly snapshot of
    the in-flight update, including a tail of `/tmp/arkmaniagest-update.log`.
  The UI polls `/status` every 2 s during the install and displays a
  live drawer with the build log, then re-checks `/health` and the
  version banner once the new backend is up.
- **`deploy/sudoers-arkmaniagest`**: drop this file under
  `/etc/sudoers.d/arkmaniagest` (mode 0440) to allow the panel user
  `arkmania` to run `server-update.sh` as root without a password.
  The snippet whitelists only the literal script path under bash, so
  a panel compromise cannot escalate via this entry.  `full-deploy.sh`
  installs it automatically (and reverts if `visudo -c` rejects it).
- **`deploy/update-panel.ps1`** and **`deploy/update-panel.sh`**:
  interactive dev-side update scripts.  Unlike the release-based
  flow, these pack the local working tree, upload it to an existing
  panel and run `server-update.sh` in place -- so a developer can
  iterate against a remote panel without cutting a GitHub release.
  Both honour `.deployignore`, auto-detect `deploy/deploy.conf`,
  support `--backend-only` / `--frontend-only` / `--no-deps`, and
  survive the backend restart via stdout streaming.

### Changed

- `full-deploy.sh` phase 9 now also installs the sudoers snippet,
  validated with `visudo -c`.  Existing deployments can enable the
  in-UI updater by running once:
  ```
  sudo install -m 0440 /opt/arkmaniagest/deploy/sudoers-arkmaniagest \
      /etc/sudoers.d/arkmaniagest
  ```

---

## [2.3.4] - 2026-04-22

### Added

- **ARK server instances module** (`/instances` page, `/api/v1/servers/*`).
  Full CRUD over `ARKM_server_instances` + lifecycle actions executed via
  SSH against POK-manager: **start / stop / restart / update / backup /
  status probe / rcon**.  Every call is audited into
  `ARKM_instance_actions` (stdout / stderr / exit code / duration) and
  the instance `status` column is transitioned (`starting` -> `running`,
  `stopping` -> `stopped`, `error` on failure, ...).
- **`ssh/pok_executor.py`**: new module that wraps POK-manager invocations
  through `PlatformAdapter` (bash on Linux, `wsl.exe` on Windows hosts),
  runs them off the event loop via `asyncio.to_thread`, and persists the
  outcome.  Long-running actions (e.g. `POK -update`, 10+ min) are
  supported; the per-call axios timeout on the UI side is bumped to 30
  minutes only for `/update`.
- **Global instance-action log endpoint** `GET /api/v1/instance-actions`
  with filters (`instance_id`, `machine_id`, `action`, `status`).

### Fixed

- **Backend boots on installs that emit empty `.env` values**.
  pydantic v2 refused to parse `PLUGIN_DB_PORT=""` into `int` and the
  service stayed in an `exited` loop after the installer wrote the real
  `.env`.  Added a `@field_validator(mode="before")` on every int / bool
  field that treats empty strings as "use the default".
- **`release.ps1` aborting on vite stderr**.  With
  `$ErrorActionPreference = "Stop"` any native command writing to stderr
  (including vite's progress lines) got promoted to a
  `NativeCommandError` before `$LASTEXITCODE` could be checked; fix
  lowers the preference for the build call only.
- **`release.ps1` mojibake on non-ASCII characters**.  `Get-Content -Raw`
  without `-Encoding UTF8` on PS 5.1 with the Italian locale re-read
  files as Windows-1252, so em-dashes / arrows / ellipses round-tripped
  to garbage when rewritten.  All three call sites now pass
  `-Encoding UTF8` explicitly.
- **`release.ps1` + `package-release.ps1` resolved `$PROJECT` wrong**.
  The scripts were moved under `deploy/maintainer/` but still did
  `$PSScriptRoot\..`, pointing at `deploy/` instead of the repo root
  ("cannot find path deploy\backend\app\main.py").
- **`full-deploy.sh` GeoIP nginx config**: the generated
  `/etc/nginx/conf.d/geoip2.conf` is now written directly from bash
  instead of via `awk` template substitution, which on Ubuntu's mawk
  silently flattened the country/whitelist multi-line variables into a
  single line ("unknown directive CH").  GeoIP DB fallback also
  extended to the current month + the previous 3 months so early-
  in-the-month deploys succeed before db-ip publishes the new DB.
- **`full-deploy.sh`**: npm is now upgraded to latest right after
  installing NodeSource Node.js 20 (silences the
  "new major version of npm available" notice on every deploy).

### UI

- New **"ARK Instances"** entry in the Main sidebar group
  (`/instances`), between Containers and Game Config.
- Per-row action toolbar with icons for start / stop / restart /
  probe / backup / update / edit / delete.  Delete gated to admin role;
  optional host-side stop before deletion.
- Expandable drawer below each row showing the 20 most recent audit
  entries with stdout/stderr/exit code/duration/user.
- `serverInstancesApi` + `instanceActionsApi` in `services/api.ts`;
  typed `ServerInstance`, `InstanceAction`, `InstanceActionResult`
  added to `types/index.ts`; `instances.*` i18n section in both
  `en.json` and `it.json`.

### Installer

- Both `install-panel.ps1` and `install-panel.sh` now dump
  `/var/log/arkmaniagest/backend-error.log` when the post-install
  `/health` poll times out — that's where uvicorn's stderr actually
  lives.  `journalctl` alone only shows systemd "Main process exited"
  noise, which is useless for diagnosing Python tracebacks.

---

## [2.3.3] - 2026-04-21

### Fixed

- **`install-panel.ps1` SSH test always failing** with
  `SSH test failed (exit ArkManiaGest-SSH-OK 0)`.  The helper
  functions `Invoke-SSH` / `Invoke-SCP` were returning
  `[stdout lines..., $LASTEXITCODE]` as a merged PowerShell pipeline,
  so the caller's `$test_rc` was an array, not an integer, and the
  `-ne 0` comparison was always truthy.
  Fix: every helper now routes the external-process output to
  `Out-Host` (or `Out-Null` for silent probes) and returns ONLY
  `$LASTEXITCODE`.  Added a second helper `Invoke-SSH-Quiet` for
  connectivity probes that must not echo to the console.

---

## [2.3.2] - 2026-04-21

### Fixed

- **`install-panel.ps1`**: the interactive installer failed to parse on
  Windows PowerShell 5.1 with the Italian UI locale.  Two issues were
  at play:
  - PowerShell 5.1 reads files without a UTF-8 BOM as Windows-1252, so
    the em-dashes (`—`) and ellipses (`…`) in comments and section
    banners broke the parser ("Token non riconosciuto").  All PS
    scripts are now ASCII-only.
  - `"@"` as a literal string inside a concatenation was parsed as a
    here-string opener.  Replaced with `[char]0x40` builder.
  - `"$var1:$var2"` interpolation was parsed as "scoped variable
    reference".  Replaced with `${var1}:${var2}` form (and string
    concatenation where safer).
- Same sanitisation applied to `deploy-remote.ps1`,
  `update-remote.ps1`, `maintainer/package-release.ps1`.

---

## [2.3.1] - 2026-04-21

First-class interactive installers and release-bundle cleanup.

### Added

- **`deploy/install-panel.ps1`** (Windows client) and
  **`deploy/install-panel.sh`** (Linux client): interactive installers
  that prompt for target server / domain / DB credentials / admin
  user, probe SSH (default keys or `ssh-agent` first; fall back to
  explicit key file or password), generate `deploy.conf` + `.env`
  with random `JWT_SECRET` / `FIELD_ENCRYPTION_KEY`, upload the
  release tree via SCP, and run `full-deploy.sh` on the remote host —
  then seed the first admin user via the `/settings/setup` endpoint.
- **`docs/INSTALL.en.md`** and **`docs/INSTALL.it.md`**: end-user
  installation guides in English and Italian, shipped inside the
  release bundle.
- README section "Panel on a Windows server" documenting the
  WSL2 + Ubuntu approach for hosting the panel on Windows VPSes.

### Changed

- Release bundles (`arkmaniagest-v*-windows.zip` /
  `arkmaniagest-v*-linux.tar.gz`) now contain **only** the scripts an
  end user needs to install or update the panel.  Maintainer scripts
  (`release.ps1`, `package-release.ps1`) moved to
  `deploy/maintainer/` and excluded from release artefacts via
  `.deployignore`.
- `.github/workflows/release.yml` keeps the user-facing `.ps1` / `.bat`
  helpers inside the Windows zip (previously all `*.ps1 *.bat *.vbs`
  were excluded because the shared exclude list served the Linux
  tarball too).  The Linux tarball still strips them, as before.

### Fixed

- **v2.3.0 Windows zip**: shipped without any `.ps1` script, making
  the interactive flow impossible from a Windows client.  Re-tagged
  and re-built.

---

## [2.3.0] - 2026-04-21

First public release.  Consolidates the entire V2 work behind a single
source-available repository: split panel/plugin databases, cross-platform
SSH support, the schema for managed Docker ARK ASA instances, a fully
bilingual (IT/EN) UI, release packaging, and an in-panel update checker.

### Added

- **Dual database architecture**: panel DB (users, SSH machines,
  settings, managed Docker instances) kept separate from the plugin DB
  (ArkMania game tables).  Configure with `DB_*` and `PLUGIN_DB_*` in
  `.env`; `PLUGIN_DB_*` empty → plugin falls back to the panel DSN, so
  legacy single-database installs keep working.
- **Managed instances schema** in the panel DB: `ARKM_server_instances`,
  `ARKM_instance_actions`, `ARKM_mariadb_instances`.  REST routes to
  manipulate these land in a follow-up release.
- **Cross-platform SSH layer** (`backend/app/ssh/platform.py`): a
  `PlatformAdapter` that wraps `docker`, `docker compose`, and
  `POK-manager.sh` invocations so they work transparently on native
  Linux hosts *and* Windows + WSL Ubuntu hosts.
- **i18n (IT/EN)**: every user-facing string on every page now goes
  through `react-i18next`.  Language toggle in the sidebar, default
  from the browser, persisted in `localStorage`.
- **SQL Console dual-DB toggle**: Panel DB / Plugin DB switch in the
  toolbar.
- **In-panel update checker**: `GET /settings/version-check` polls the
  GitHub Releases API (cached 1 h) and a card in General Settings shows
  the running version, the latest release, and a link to its notes.
- **Release packaging**:
  - `deploy/package-release.ps1` builds self-contained Linux and
    Windows bundles locally.
  - `.github/workflows/release.yml` publishes the same two artefacts
    plus `SHA256SUMS.txt` to a GitHub Release whenever a `v*` tag is
    pushed.  The release body is auto-populated from this CHANGELOG.
- **Community files**: `LICENSE` (source-available, non-commercial),
  `CONTRIBUTING.md` (contribution assignment clause), `SECURITY.md`,
  `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`, CI
  workflow.
- **`deploy/migrate-env.sh`**: idempotent backfill of new `.env`
  keys on upgrade.

### Changed

- README + CHANGELOG + all deploy scripts rewritten in English.
- `Specifiche/` → `docs/` with an English walkthrough of the ServerForge
  API reference.
- `deploy/deploy.conf` is no longer tracked; `deploy/deploy.conf.example`
  ships as the template.  Scripts fall back to the template with a
  warning when the real config is missing.
- History rewrite: earlier internal development has been squashed into
  a single "V2 baseline" commit; the git log now starts with V2.

### Security

- Sensitive IPs previously tracked in the repo (production server IP +
  admin office IP) have been scrubbed from git history via
  `git-filter-repo`.
- SSH passwords and passphrases stored AES-256-GCM encrypted in the
  panel DB (unchanged, documented).

### Licensing

- Project released as **source-available** under the **ArkManiaGest
  Source-Available License v1.0** (see `LICENSE`).  Commercial use is
  prohibited; deployment / redistribution require prior written
  authorisation from Lomatek / ArkMania.it (`info@arkmania.it`).

### Upgrade notes

- Run `deploy/migrations/001_arkmania_config_unique.sql` and
  `deploy/migrations/002_ssh_machines_os_type.sql` once on the live DB.
- If you upgrade an existing install: `deploy/migrate-env.sh` will
  add the new `PLUGIN_DB_*`, `GITHUB_REPO`, `GITHUB_TOKEN` keys to
  your `.env` with safe empty defaults.
- POK integration (container lifecycle routes, bootstrap endpoint,
  frontend management page) is deliberately NOT in 2.3.0 — it is the
  headline feature of the upcoming 2.4 line.

---

## [Unreleased] — Phase 2: Cross-platform SSH (Linux / Windows+WSL)

### New `PlatformAdapter` abstraction

Prerequisite for the POK bootstrap work: every `docker`, `docker compose`
and `POK-manager.sh` invocation now goes through a wrapper that
translates a bash command into whatever syntax the game host's OS
expects.

### Backend

- **`arkmaniagest_machines`**: new columns `os_type` (`linux` / `windows`,
  default `linux`) and `wsl_distro` (default `Ubuntu`).  The
  `server_default` transparently covers pre-existing rows.
- **`deploy/migrations/002_ssh_machines_os_type.sql`**: idempotent
  `ALTER TABLE` for deployments upgrading an existing DB.
- **`app/schemas/ssh_machine.py`**: new `OSTypeEnum` + `os_type` /
  `wsl_distro` fields on Create / Update / Read schemas.
- **`app/ssh/platform.py`**: new `PlatformAdapter` class (`wrap_shell`,
  `docker`, `compose`, `pok`, `prereqs_check_cmd`, `default_pok_base_dir`,
  `join_path`).  Correct bash single-quote escaping for the
  `wsl.exe -d <distro> -- bash -c '...'` wrapper on Windows hosts.
  `from_machine(dict)` falls back to `linux` for legacy rows.
- **`app/api/routes/machines.py`**: create / update / duplicate persist
  `os_type` / `wsl_distro`; the read endpoint returns them normalised.

### Frontend

- **`types/index.ts`**: new `OSType = "linux" | "windows"` +
  `os_type` / `wsl_distro` fields on `SSHMachine` / `SSHMachineCreate`.
- **`MachinesPage`**: "Host OS" selector (native Linux / Windows + WSL),
  WSL distro field shown only when Windows is selected, OS badge in the
  card header, and a dedicated "Host OS" detail inside the expanded
  panel.

### No new routes in Phase 2

The POK bootstrap and prereqs-check endpoints land in Phase 3 and will
reuse `PlatformAdapter.prereqs_check_cmd()` which is already in place.

---

## [Unreleased] — Phase 1: Docker/POK instance schema

### New tables (Panel DB)

Three panel-owned tables to host the ARK ASA instances managed through
POK-manager plus the MariaDB instances co-located on the same machines.
They are auto-created on the next startup via `create_app_tables()` on
the Panel DB only.

- **`ARKM_server_instances`** (35 columns) — one row per ARK ASA
  container.  Key fields: `machine_id`, `name`, `map_name`,
  `session_name`, `game_port` / `rcon_port`, `cluster_id`, mods,
  `container_name`, `image`, `mem_limit_mb`, `pok_base_dir` /
  `instance_dir`, feature flags (`mod_api` / `battleye` /
  `update_server` / …), runtime state + timestamps.  Admin and server
  passwords are stored AES-256-GCM encrypted in the `*_enc` columns.
- **`ARKM_instance_actions`** (15 columns) — lifecycle audit log
  (bootstrap / create / start / stop / restart / update / backup /
  delete / rcon / pok_sync).  Rows are preserved even after the related
  instance is deleted (`ON DELETE SET NULL` on `instance_id` /
  `machine_id` / `user_id`) so the history remains queryable.
- **`ARKM_mariadb_instances`** (17 columns) — one row per managed
  MariaDB container.  Root password AES-256-GCM, `databases_json` with
  the list of databases + users provisioned inside the container
  (per-database passwords encrypted too).

### Backend

- **`app/db/session.py`**: `create_app_tables()` now creates **only**
  the tables defined in `app.db.models.app`, even though `Base.metadata`
  also contains the ARK plugin ORM classes (`Players`, `ArkShopPlayers`,
  …).  The plugin tables stay owned by the game plugins and must never
  be touched by the panel.
- **`app/db/models/app.py`**: the three new ORM classes with explicit
  foreign keys to `arkmaniagest_machines` and `arkmaniagest_users`.
- **`app/schemas/server_instance.py`** / **`instance_action.py`** /
  **`mariadb_instance.py`**: Pydantic Create / Update / Read schemas
  with enums for state, update coordination role and action types.
  Passwords are never returned in read responses (only the
  `has_*_password` flags).
- **`app/core/store.py`**: async helpers `get_instance_async`,
  `get_all_instances_async`, `log_action_async`,
  `finalise_action_async`, `list_actions_async`, `get_mariadb_async`,
  `get_all_mariadb_async` + row-to-dict normalisers that decrypt
  passwords and sanitise the JSON inside MariaDB instances.

### No REST routes yet

The REST API (`/api/v1/instances/…`, `/api/v1/mariadb/…`) lands in the
following phases (POK bootstrap + instance CRUD), after the
cross-platform SSH layer is in place.

---

## [Unreleased] — Phase 0: Panel / Plugin DB separation

### Infrastructure refactor

First step of the Docker POK-manager effort: the panel database is
split from the game-plugin database.  This is a prerequisite for
hosting the new `ARKM_server_instances`, `ARKM_instance_actions`,
`ARKM_mariadb_instances` tables on the panel without polluting the
plugin schema.

#### Backend

- **`.env`**: new `PLUGIN_DB_HOST`, `PLUGIN_DB_PORT`, `PLUGIN_DB_NAME`,
  `PLUGIN_DB_USER`, `PLUGIN_DB_PASSWORD` variables.  When any of them
  is left empty the plugin connection transparently falls back to the
  panel DSN — existing single-DB deployments keep working without
  changes.
- **`app/core/config.py`**: new `plugin_database_url`,
  `plugin_db_host/port/name/user/password`, `plugin_db_is_separate`
  properties.
- **`app/db/session.py`**: second engine / session factory with
  `init_plugin_engine()` and a `get_plugin_db()` dependency (alongside
  `get_db` / alias `get_panel_db`).  New `close_plugin_engine()`
  wired in the lifespan handler.
- **`app/core/store.py`**: new `_sync_plugin_db_connection()` context
  manager for sync code that needs to target the plugin DB.
- **Routes switched to `get_plugin_db`**: `arkmania_bans`,
  `arkmania_rare_dinos`, `arkmania_transfer_rules`,
  `arkmania_leaderboard`, `arkmania_config`, `arkmania_decay`,
  `players`, `public`.  No route performs cross-DB joins: every
  left-join was between plugin tables (`ARKM_*` + native ARK
  `Players`), so queries remain atomic.
- **Panel routes unchanged** (`get_db`): `auth`, `machines`,
  `serverforge`, `settings`.
- **SQL Console**: the `/sql/execute`, `/sql/tables`,
  `/sql/tables/{name}/schema` endpoints now accept
  `database: "panel" | "plugin"` (default: `panel`).
- **`GET /settings/database`**: schema upgraded to
  `DualDatabaseConfigRead` with `panel` + `plugin` blocks + the
  `plugin_is_separate` / `plugin_configured` flags.
- **New endpoint**: `POST /settings/database/test-plugin` to test the
  plugin DB with the credentials currently in `.env`.
- **`/health`**: new `plugin_db_ready` field.

#### Frontend

- **`DatabaseSettingsPage`**: renders two separate cards (Panel /
  Plugin), each with its own connection parameters and Test button.
  "separate" / "shared with panel" badge on the plugin card + a hint
  explaining the fallback.
- **`SqlConsolePage`**: Panel DB / Plugin DB toggle in the toolbar.
  Switching the target reloads the tables listing and resets the
  schema accordion.  Every `Execute` includes the selected target.
- **Types**: new `DualDatabaseConfig` + `SqlDatabaseTarget`.

#### Developer setup

- POK reference (`reference/POK-ASA-Server/`) is now cloned locally and
  listed in `.gitignore` as the reference for Phase 3 (ARK ASA
  container bootstrap).

---

## Historical

Earlier development of ArkManiaGest (migration from the local vault to
the `.env` + DB architecture, introduction of the ArkMania plugin
editor, ServerForge import, shop editor, blueprint database, and the
SSH scanner) has been consolidated into a single baseline commit
("Unificazione commit per V2 gestionale arkmania") at the start of
the V2 work.  The detailed timeline of that pre-V2 history is no
longer tracked in this file; the squashed baseline is the starting
point of the public repository.
