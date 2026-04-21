# ArkManiaGest V2

**Admin panel for ARK: Survival Ascended clusters.**

ArkManiaGest manages ARK servers hosted in Docker containers (POK-manager)
across Linux and Windows hosts over SSH.  The panel database is kept
separate from the game-plugin database so admin data and in-game data
never clash.

---

## Features

### Dashboard & Infrastructure
- Real-time dashboard (servers online, players, bans)
- **SSH machines**: full CRUD, connection tests, AES-256-GCM encrypted
  credentials
- Legacy **ServerForge** import with on-demand SSH credentials
- Remote container scanner: discovers `ShooterGame`, `SavedArks`, plugin,
  INI and log paths
- **Dual database**: panel and game-plugin connections are separated —
  switch them from a single `.env`

### ARK ASA instances (in progress)
Direct integration with
[`Ark-Survival-Ascended-Server`](https://github.com/Acekorneya/Ark-Survival-Ascended-Server)
by Acekorneya (referred to as "POK-manager") for:
- Bootstrapping Docker + POK-manager on a remote host
- Create / start / stop / restart / update / backup of ARK ASA containers
- Built-in RCON console with command history
- Multiple instances per host, MASTER/FOLLOWER update coordination
- Host support for **native Linux** and **Windows + WSL Ubuntu**
- Weekly sync of the POK script from the local reference checkout

### MariaDB instances (in progress)
- Managed `mariadb:*` containers on game hosts to serve the plugin DB
  (distributed per cluster)
- Multiple instances per host; provisioning of dedicated databases + users
- Automatic wiring into the panel's `PLUGIN_DB_*` configuration

### Players
- ARK player management with shop points, permanent + timed permissions
- **Name sync from `.arkprofile`** — extracts the display name from the
  UE5 binary over SSH
- Sorting / filtering / grouping; timed-permission editor with quick
  extensions (+1m / +3m / +12m)
- Character transfer between cluster maps over SSH

### ArkMania plugin suite (DB-centralised)
- **Config Editor** — manage every module (Login, Plus, RareDino, ItemPlus,
  ServerRules, DeadSaver, CrossChat, DecayManager, Discord, Messages)
- Everything lives in `ARKM_config` (key/value with per-server overrides)
- **Ban Manager** — cluster-wide CRUD with expiry, search, unban
- **Rare Dinos** — pool management with inline stat editing, enable toggles
- **Transfer Rules** — server-to-server transfer rules (full / survivor /
  blocked)
- **Decay** — monitor tribes in decay and the purge queue
- **Leaderboard** — ranking per map with event history

### ArkShop plugin
- Full editor for Shop Items, Kits, Sell Items
- **Blueprint search** powered by the embedded Dododex index
- Plugin MySQL config, General settings (Discord, Timed Points), Messages
- SSH pull / deploy with versioning

### Remote config editors
- Remote file viewer + navigable file browser inside containers
- **Game Config Editor** — visual editor for `GameUserSettings.ini` and
  `Game.ini`

### Blueprint database
- Downloaded from the Dododex GitHub repo (creatures, items, admin
  commands)
- Full-text search, filtering by type / category

### SQL Console (admin only)
- SQL console with a **Panel DB / Plugin DB** toggle
- Table browser + schema panel + in-session query history
- 30 s statement timeout

### Security
- AES-256-GCM encryption for SSH passwords, ASA admin and server
  passwords, managed-MariaDB root passwords
- JWT authentication with multiple roles (Admin / Operator / Viewer)
- Rate limiting + IP lockout on brute force
- Security headers (CSP, HSTS, X-Frame-Options, nosniff)
- GeoIP allowlist (IT/CH by default) + IP whitelist
- UFW firewall + Fail2ban
- Let's Encrypt HTTPS with auto-renewal

---

## Database architecture

ArkManiaGest uses two distinct MariaDB connections:

| DB | Content | `.env` variables |
|----|---------|------------------|
| **Panel** | Panel users, SSH machines, settings, ARK ASA instances (`ARKM_server_instances`), action log, managed MariaDB instances | `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` |
| **Plugin** | ArkMania plugin data (`ARKM_config`, `ARKM_bans`, `ARKM_rare_dinos`, …), native ARK tables (`Players`, `ArkShopPlayers`, …) | `PLUGIN_DB_HOST`/`PLUGIN_DB_PORT`/`PLUGIN_DB_NAME`/`PLUGIN_DB_USER`/`PLUGIN_DB_PASSWORD` |

If the `PLUGIN_DB_*` variables are left empty, the plugin connection
transparently falls back to the panel parameters — existing single-DB
deployments keep working without changes.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| UI | Custom CSS, Lucide icons, Plus Jakarta Sans |
| i18n | react-i18next (IT / EN) |
| Backend | Python 3.12 + FastAPI + Uvicorn |
| ORM | SQLAlchemy 2 async (aiomysql) + PyMySQL sync |
| Database | MariaDB (Panel + Plugin, see above) |
| Crypto | Fernet / AES-256-GCM (cryptography) |
| SSH | Paramiko + SCP |
| Container runtime | Docker + POK-manager (ARK ASA) — plain Docker CLI for MariaDB |
| Deploy | Nginx + systemd + Let's Encrypt |

---

## Project layout

```
ArkManiaGest/
├── backend/
│   ├── app/
│   │   ├── api/routes/              # REST endpoints
│   │   │   ├── arkmania_*.py        # Config / Ban / Rare / Transfer / Decay / LB
│   │   │   ├── arkshop.py           # ArkShop editor (SSH)
│   │   │   ├── auth.py              # Login + panel users
│   │   │   ├── containers.py        # SSH container scanner (read-only)
│   │   │   ├── game_config.py       # Remote INI editor
│   │   │   ├── machines.py          # SSH machine CRUD
│   │   │   ├── players.py           # ARK player management
│   │   │   ├── public.py            # Read-only public API
│   │   │   ├── serverforge.py       # ServerForge machine import
│   │   │   ├── settings.py          # Setup + DB config
│   │   │   └── sql_console.py       # Admin SQL console (panel/plugin)
│   │   ├── core/                    # JWT auth, crypto, config, store
│   │   ├── db/
│   │   │   ├── models/
│   │   │   │   ├── app.py           # Panel ORM tables (users, machines,
│   │   │   │   │                    # settings + ARKM_server_instances,
│   │   │   │   │                    # ARKM_instance_actions,
│   │   │   │   │                    # ARKM_mariadb_instances)
│   │   │   │   └── ark.py           # Plugin ORM tables (Players, ArkShop…)
│   │   │   └── session.py           # Two async engines (panel + plugin)
│   │   ├── schemas/                 # Pydantic in/out
│   │   └── ssh/                     # SSH manager, scanner, profile parser,
│   │                                # cross-platform PlatformAdapter
│   ├── data/                        # Runtime state (not in git)
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── i18n/                    # react-i18next setup + locale files
│       ├── pages/                   # React pages
│       ├── components/              # Sidebar, StatusBadge
│       ├── services/api.ts          # Axios API client
│       └── types/                   # TypeScript types
├── deploy/                          # Deploy scripts + server config
│   ├── deploy-remote.ps1            # First deploy from the dev PC
│   ├── update-remote.ps1            # Incremental update
│   ├── full-deploy.sh               # Full Linux server setup
│   ├── server-update.sh             # Server-side update
│   ├── migrate-env.sh               # Idempotent .env key backfill
│   ├── test_db.py                   # Panel + Plugin DB diagnostics
│   └── ...                          # Nginx, systemd, SSL, cron, backup
├── Specifiche/                      # ServerForge API specs (not deployed)
├── reference/                       # POK-manager checkout (gitignored)
├── CHANGELOG.md
└── README.md
```

---

## Quick setup (development)

### Prerequisites
- Python 3.12+, Node.js 20+, MariaDB 10.6+

### Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp ../deploy/.env.production .env    # then edit DB_*
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### First admin
Open `http://localhost:5173`, the setup wizard creates the initial
administrator.

---

## Production deploy

### First deploy (from a Windows PC)
```powershell
.\deploy\deploy-remote.ps1
```

### Update
```powershell
.\deploy\update-remote.ps1            # full
.\deploy\update-remote.ps1 -BackendOnly
.\deploy\update-remote.ps1 -FrontendOnly
```

### Server-side DB check
```bash
sudo -u arkmania /opt/arkmaniagest/backend/venv/bin/python \
    /opt/arkmaniagest/deploy/test_db.py
```
Verifies connectivity and row counts for the core tables on both Panel
and Plugin databases.

Full guide: [deploy/README.md](deploy/README.md).

---

## Credits & third-party projects

ArkManiaGest orchestrates ARK: Survival Ascended containers by building
on the open-source project
**[Ark-Survival-Ascended-Server](https://github.com/Acekorneya/Ark-Survival-Ascended-Server)**
by **Acekorneya**, distributed under the
[MIT License](https://opensource.org/license/mit/).  We thank the author
for maintaining the Docker image, the POK-manager scripts, and the
`docker-compose.yaml` template we use as a baseline for our ARK ASA
instances.

The POK-manager code remains the property of its authors and keeps its
own MIT licence: when we clone their repo into `reference/` (not
included in this project's deployment tarball), its `LICENSE.txt` comes
along.

Other third-party libraries (FastAPI, SQLAlchemy, React, Vite, Paramiko,
cryptography, …) are used under their respective open-source licences —
see `backend/requirements.txt` and `frontend/package.json`.

---

## Licence

Public repository, **not open source**.

ArkManiaGest is released under the **ArkManiaGest Source-Available
License v1.0** — see [LICENSE](LICENSE).

Summary:

- Source is publicly visible for transparency and evaluation.
- **Any deploy or redistribution requires prior written authorisation
  from Lomatek / ArkMania.it.**
- **Commercial use is strictly prohibited** in every form (SaaS,
  resale, bundling into paid products, …) — even under a granted
  non-commercial authorisation.
- You are allowed to clone the repo for personal evaluation on a
  test environment.

To request an authorisation, write to **info@arkmania.it**.

Copyright © 2024–2026 Lomatek / ArkMania.it — All rights reserved.
