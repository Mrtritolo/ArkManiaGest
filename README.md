# ArkManiaGest V2

**Portale di amministrazione per cluster ARK: Survival Ascended.**

Gestione completa di server ARK ospitati in container Docker (POK-manager)
su macchine Linux e Windows collegate via SSH, con database del pannello
separato dal database dei plugin di gioco.

---

## Funzionalita'

### Dashboard & Infrastruttura
- Dashboard con statistiche real-time (server online, giocatori, ban)
- **Macchine SSH**: CRUD completo, test connessione, credenziali cifrate
  AES-256-GCM
- Import macchine da **ServerForge** (legacy) con credenziali on-demand
- Scanner container remoto: discovery percorsi ShooterGame / SavedArks /
  Plugin / Config INI / Logs
- **Dual database**: pannello e plugin di gioco su connessioni separate —
  cambio DB in un singolo `.env`

### Istanze ARK ASA (in sviluppo)
Integrazione diretta con
[`Ark-Survival-Ascended-Server`](https://github.com/Acekorneya/Ark-Survival-Ascended-Server.git)
di Acekorneya (d'ora in poi "POK-manager") per:
- Bootstrap Docker + POK-manager sulla macchina remota
- Creazione / avvio / stop / restart / update / backup container ARK ASA
- Console RCON integrata con persistenza comandi
- Multi-instance per macchina, coordinamento update master/follower
- Supporto host **Linux nativo** e **Windows+WSL Ubuntu**
- Sync settimanale dello script POK dalla copia di riferimento locale

### Istanze MariaDB (in sviluppo)
- Container `mariadb:*` gestiti sulle macchine di gioco per ospitare il DB
  dei plugin (distribuito per cluster)
- Multi-instance per macchina, provisioning di database + utenti dedicati
- Collegamento automatico al `PLUGIN_DB_*` del pannello

### Giocatori
- Gestione giocatori ARK con punti shop, permessi fissi + temporanei
- **Sync nomi da `.arkprofile`** — estrae il display name dal binario UE5
  via SSH
- Ordinamento / filtri / gruppi, editor permessi con estensione rapida
  (+1m / +3m / +12m)
- Trasferimento personaggio fra mappe del cluster via SSH

### ArkMania Plugin Suite (DB-centralizzato)
- **Config Editor** — gestione di tutti i moduli (Login, Plus, RareDino,
  ItemPlus, ServerRules, DeadSaver, CrossChat, DecayManager, Discord,
  Messages)
- Tutto in `ARKM_config` (key/value con override per server)
- **Ban Manager** — CRUD ban cluster-wide con scadenza, ricerca, sblocco
- **Rare Dinos** — pool dino rari con stat editing inline, toggle enable
- **Transfer Rules** — regole trasferimento server-to-server
  (full/survivor/blocked)
- **Decay** — monitor tribe in decay e purge queue
- **Leaderboard** — ranking per mappa con storico eventi

### Plugin ArkShop
- Editor completo per Shop Items, Kits, Sell Items
- **Ricerca Blueprint** dall'anagrafica Dododex integrata
- Configurazione MySQL del plugin, General (Discord, Timed Points),
  Messaggi
- Pull/Deploy via SSH con versionamento

### Editor config remote
- Visualizzatore file remoto + file browser navigabile dentro ai container
- **Game Config Editor** — editor visuale per
  `GameUserSettings.ini` e `Game.ini`

### Blueprint Database
- Download da Dododex GitHub (creature, items, comandi admin)
- Ricerca fulltext, filtro per tipo/categoria

### SQL Console (admin)
- Console SQL con toggle **Panel DB / Plugin DB**
- Browser tabelle + schema + cronologia query in-session
- Timeout di sicurezza 30s sulle query

### Sicurezza
- Crittografia AES-256-GCM per password SSH, admin e server ARK, root
  MariaDB gestite
- Autenticazione JWT multi-utente (Admin / Operatore / Viewer)
- Rate limiting API + blocco IP brute force
- Security headers (CSP, HSTS, X-Frame-Options, nosniff)
- GeoIP allowlist (IT/CH default) + whitelist IP
- Firewall UFW + Fail2ban
- HTTPS Let's Encrypt con auto-rinnovo

---

## Architettura database

ArkManiaGest usa due connessioni MariaDB distinte:

| DB | Contenuto | Variabili `.env` |
|----|-----------|------------------|
| **Panel** | Utenti pannello, macchine SSH, settings, istanze ARK ASA (`ARKM_server_instances`), log azioni, istanze MariaDB gestite | `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` |
| **Plugin** | Config plugin ArkMania (`ARKM_config`, `ARKM_bans`, `ARKM_rare_dinos`, …), tabelle native ARK (`Players`, `ArkShopPlayers`, …) | `PLUGIN_DB_HOST`/`PLUGIN_DB_PORT`/`PLUGIN_DB_NAME`/`PLUGIN_DB_USER`/`PLUGIN_DB_PASSWORD` |

Se le variabili `PLUGIN_DB_*` sono vuote, la connessione plugin ricade
automaticamente sui parametri del pannello — gli ambienti single-database
esistenti continuano a funzionare senza modifiche.

---

## Stack tecnico

| Layer | Tecnologia |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| UI | CSS custom, Lucide icons, Plus Jakarta Sans |
| Backend | Python 3.12 + FastAPI + Uvicorn |
| ORM | SQLAlchemy 2 async (aiomysql) + PyMySQL sync |
| Database | MariaDB (Panel + Plugin, vedi sopra) |
| Cifratura | Fernet / AES-256-GCM (cryptography) |
| SSH | Paramiko + SCP |
| Container runtime | Docker + POK-manager (ARK ASA) — Docker CLI remoto (MariaDB) |
| Deploy | Nginx + Systemd + Let's Encrypt |

---

## Struttura progetto

```
ArkManiaGest/
├── backend/
│   ├── app/
│   │   ├── api/routes/              # Endpoint REST
│   │   │   ├── arkmania_*.py        # Config / Ban / Rare / Transfer / Decay / LB
│   │   │   ├── arkshop.py           # Editor ArkShop (SSH)
│   │   │   ├── auth.py              # Login + utenti pannello
│   │   │   ├── containers.py        # Scanner container SSH (read-only)
│   │   │   ├── game_config.py       # Editor INI remoti
│   │   │   ├── machines.py          # CRUD macchine SSH
│   │   │   ├── players.py           # Gestione giocatori ARK
│   │   │   ├── public.py            # API pubblica read-only
│   │   │   ├── serverforge.py       # Import macchine ServerForge
│   │   │   ├── settings.py          # Setup + config DB
│   │   │   └── sql_console.py       # Console SQL admin (panel/plugin)
│   │   ├── core/                    # Auth JWT, cifratura, config, store
│   │   ├── db/
│   │   │   ├── models/
│   │   │   │   ├── app.py           # ORM tabelle panel (utenti, macchine,
│   │   │   │   │                    # settings + ARKM_server_instances,
│   │   │   │   │                    # ARKM_instance_actions,
│   │   │   │   │                    # ARKM_mariadb_instances)
│   │   │   │   └── ark.py           # ORM tabelle plugin (Players, ArkShop…)
│   │   │   └── session.py           # Due engine async (panel + plugin)
│   │   ├── schemas/                 # Pydantic in/out
│   │   └── ssh/                     # SSH manager, scanner, profile parser
│   ├── data/                        # Runtime (non in git)
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── pages/                   # Pagine React
│       ├── components/              # Sidebar, StatusBadge
│       ├── services/api.ts          # Client API axios
│       └── types/                   # TypeScript types
├── deploy/                          # Script deploy + config server
│   ├── deploy-remote.ps1            # Primo deploy da PC
│   ├── update-remote.ps1            # Update incrementale
│   ├── full-deploy.sh               # Setup completo server Linux
│   ├── server-update.sh             # Update server-side
│   ├── migrate-env.sh               # Aggiunta chiavi .env mancanti (idempotente)
│   ├── test_db.py                   # Diagnostica connessione Panel + Plugin
│   └── ...                          # Nginx, systemd, SSL, cron, backup
├── Specifiche/                      # Doc API ServerForge (non deployate)
├── reference/                       # Sorgenti POK-manager (gitignored)
├── CHANGELOG.md
└── README.md
```

---

## Setup rapido (sviluppo)

### Prerequisiti
- Python 3.12+, Node.js 20+, MariaDB 10.6+

### Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp ../deploy/.env.production .env    # poi edita DB_*
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Primo utente admin
Apri `http://localhost:5173`, il setup wizard crea l'amministratore iniziale.

---

## Deploy produzione

### Primo deploy (da PC Windows)
```powershell
.\deploy\deploy-remote.ps1
```

### Aggiornamento
```powershell
.\deploy\update-remote.ps1            # full
.\deploy\update-remote.ps1 -BackendOnly
.\deploy\update-remote.ps1 -FrontendOnly
```

### Verifica DB lato server
```bash
sudo -u arkmania /opt/arkmaniagest/backend/venv/bin/python \
    /opt/arkmaniagest/deploy/test_db.py
```

Verifica connettività e conteggi delle tabelle core di Panel + Plugin.

Guida completa: [deploy/README.md](deploy/README.md).

---

## Licenza

Proprietary — ArkMania.it
