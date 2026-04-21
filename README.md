# ⬡ ArkManiaGest V 2.1.0

**Portale di amministrazione per server ARK: Survival Ascended**

Gestione completa di server ARK ospitati in container ServerForge su macchine Linux via SSH.

---

## Funzionalita'

### Dashboard & Server
- Dashboard con statistiche in tempo reale
- Integrazione **ServerForge** API (macchine, container, cluster)
- Import automatico macchine SSH da ServerForge

### Giocatori
- Gestione giocatori con punti shop, permessi fissi e temporanei
- **Sync nomi da .arkprofile** — estrae nomi dal binario UE5 via SSH
- Ordinamento per colonna, filtri per gruppo (fissi + temporanei)
- Editor permessi temporanei con estensione rapida (+1m, +3m, +12m)

### ArkMania Plugin Suite (DB-centralizzato)
- **Config Editor** — gestione centralizzata di tutti i moduli ArkMania (Login, Plus, RareDino, ItemPlus, ServerRules, DeadSaver, CrossChat, DecayManager, Discord, Messages)
- Tutti i setting in `arkmania_config` (key-value con override per server)
- **Ban Manager** — CRUD ban cluster-wide con scadenza, ricerca, sblocco
- **Rare Dinos** — gestione pool dino rari con stat editing inline, toggle abilitazione
- **Transfer Rules** — regole trasferimento server-to-server (full/survivor/blocked)
- 11 server auto-registrati con heartbeat e status real-time

### Plugin ArkShop
- Editor completo con dialog modale per Shop Items, Kits, Sell Items
- **Ricerca Blueprint** dall'anagrafica Dododex integrata
- Configurazione MySQL, General (Discord, Timed Points), Messaggi
- Pull/Deploy via SSH con versionamento

### Container SSH & Config Editor
- Scansione automatica container di gioco via SSH
- Discovery percorsi: ShooterGame, SavedArks, Plugin, Config INI, Logs
- Visualizzatore file remoto e file browser navigabile
- **Game Config Editor** — editor visuale per GameUserSettings.ini e Game.ini

### Blueprint Database
- Download da Dododex GitHub (creature, items, comandi admin)
- Ricerca fulltext, filtro per tipo/categoria

### Sicurezza
- **Vault criptato locale** (AES-256) — credenziali mai in chiaro
- Autenticazione JWT multi-utente (Admin, Operatore, Viewer)
- Rate limiting API + blocco IP brute force
- Security headers (CSP, HSTS, X-Frame-Options)
- GeoIP Italia + whitelist IP
- Firewall UFW + Fail2ban
- HTTPS Let's Encrypt con auto-rinnovo

---

## Stack Tecnico

| Layer | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| UI | CSS custom, Lucide icons, Plus Jakarta Sans |
| Backend | Python 3.12 + FastAPI + Uvicorn |
| Database | MariaDB (remoto, via SQLAlchemy async) |
| Plugin Config | MySQL diretto (`arkmania_config` key-value) |
| SSH | Paramiko + SCP |
| Vault | Fernet (cryptography) |
| Deploy | Nginx + Systemd + Let's Encrypt |

---

## Deploy Produzione

### Primo deploy (da PC Windows)
```powershell
.\deploy\deploy-remote.ps1
```

### Aggiornamento
```powershell
.\deploy\update-remote.ps1
.\deploy\update-remote.ps1 -BackendOnly
.\deploy\update-remote.ps1 -FrontendOnly
```

Vedi [deploy/README.md](deploy/README.md) per la guida completa.

---

## Struttura Progetto

```
ArkManiaGest/
├── backend/
│   ├── app/
│   │   ├── api/routes/         # Endpoint REST
│   │   │   ├── arkmania_*.py   # Config DB, Ban, RareDinos, TransferRules
│   │   │   ├── arkshop.py      # Editor ArkShop (SSH)
│   │   │   ├── containers.py   # Scanner container SSH
│   │   │   ├── game_config.py  # Editor INI files
│   │   │   ├── players.py      # Gestione giocatori
│   │   │   └── ...
│   │   ├── core/               # Auth JWT, Vault, Config
│   │   ├── db/                 # SQLAlchemy models + session
│   │   └── ssh/                # SSH manager, scanner, parser
│   ├── data/                   # Vault criptato (non in git)
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── pages/              # 15 pagine React
│       ├── components/         # Sidebar, StatusBadge
│       ├── services/api.ts     # Client API axios
│       └── types/              # TypeScript types
├── deploy/                     # Script deploy + config server
│   ├── update-remote.ps1       # Aggiornamento da PC
│   ├── deploy-remote.ps1       # Primo deploy da PC
│   ├── full-deploy.sh          # Setup completo server
│   ├── server-update.sh        # Update server-side
│   └── ...                     # Nginx, systemd, backup, cron
├── Specifiche/                 # Docs API ServerForge
├── CHANGELOG.md
└── README.md
```

---

## Licenza

Proprietary — ArkMania.it
