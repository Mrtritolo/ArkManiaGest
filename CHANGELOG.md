# Changelog

All notable changes to ArkManiaGest are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).

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
