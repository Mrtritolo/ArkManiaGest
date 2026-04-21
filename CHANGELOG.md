# 📝 Changelog

Tutte le modifiche rilevanti al progetto ArkManiaGest sono documentate in questo file.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/)
e il progetto aderisce al [Semantic Versioning](https://semver.org/lang/it/).

---

## [2.2.2] - 2026-03-26

### Tribe Name Resolution Fix

#### Bug corretti

- **🔴 CRITICO — Tribe name ovunque mancante**: tutti gli endpoint che mostravano
  il nome tribù leggevano `arkmania_tribe_decay.last_refresh_name` che contiene
  il nome del **giocatore** che ha aggiornato il decay (spesso "Unknown" o vuoto),
  NON il nome della tribù. Il campo corretto è `tribe_name`, presente sia in
  `arkmania_player_tribes` (fonte primaria, aggiornata ad ogni login) che in
  `arkmania_tribe_decay` (fallback).
  
  Endpoint corretti:
  - `GET /players` (list_players) — ora legge `tribe_name` da `player_tribes`
    con fallback a `tribe_decay.tribe_name`
  - `GET /players/{id}` (get_player) — stessa catena di fallback
  - `GET /arkmania/decay/tribes` (list_decay_tribes) — ora usa `d.tribe_name`
    invece di `d.last_refresh_name` nel SELECT e nel mapping
  - `GET /arkmania/decay/pending` (list_pending) — stessa correzione
  - `GET /public/players` — ora interroga `arkmania_player_tribes.tribe_name`
    invece di `arkmania_player_history.player_name` (che è il nome giocatore)

#### Migliorato

- **Ricerca giocatori per tribù**: `GET /players?search=` ora cerca anche in
  `arkmania_player_tribes.tribe_name` (prima cercava solo nome e EOS_Id)
- **Ricerca decay tribes**: aggiunto `d.tribe_name LIKE` al filtro di ricerca
  in `/arkmania/decay/tribes`

---

## [2.2.1] - 2026-03-26

### Bug Fix & Code Quality (full backend audit)

#### Bug corretti

- **🔴 CRITICO — `arkmania_config`**: tutte le operazioni `ON DUPLICATE KEY UPDATE`
  (upsert) erano silenziosamente inutili perché la tabella non aveva l'indice
  `UNIQUE(server_key, config_key)` richiesto. Ogni salvataggio inseriva una nuova
  riga duplicata invece di aggiornare quella esistente.
  → **Creata migration SQL** in `deploy/migrations/001_arkmania_config_unique.sql`
  → Aggiunto commento obbligatorio al modulo `arkmania_config.py`

- **🔴 CRITICO — `arkmania_rare_dinos.py`**: `list_rare_spawns` interrogava colonne
  inesistenti `player_eos` / `player_name`; le colonne reali nella tabella
  `arkmania_rare_spawns` sono `killer_eos` / `killer_name`. L'endpoint andava in
  errore MariaDB ad ogni chiamata.

- **🟠 `scanner.py` `write_remote_file`**: variabili di ritorno di `ssh.execute()`
  invertite (`_stderr, _, exit_code` invece di `_stdout, _stderr, exit_code`).

- **🟠 `containers.py` `browse_container`**: sanitizzazione path traversal
  (`sub_path.replace("..")`) non bloccava pattern come `....//`. Sostituita con
  `posixpath.normpath` + verifica del prefisso del container.

- **🟡 Route trailing slash**: tutti i router `arkmania_bans`, `arkmania_decay`,
  `arkmania_leaderboard`, `arkmania_rare_dinos`, `arkmania_transfer_rules` avevano
  `@router.get("/")` che con `redirect_slashes=False` diventava accessibile solo
  con `GET .../bans/`. Uniformati a `@router.get("")`.

- **🟡 `arkmania_decay.py` `list_decay_tribes`**: `LIKE` applicato alla colonna
  INT `targeting_team`, semanticamente errato. Rimosso; la ricerca opera ora su
  `last_refresh_eos` e i campi stringa.

- **🟡 Double `db.commit()`**: i route handler chiamavano `await db.commit()`
  esplicitamente anche se la dependency `get_db` esegue già il commit automatico.
  Rimossi tutti i commit espliciti da `arkmania_bans`, `arkmania_config`,
  `arkmania_rare_dinos`, `arkmania_transfer_rules`.

- **🟡 `arkmania_bans.py`**: `expire_time` era `Optional[str]` senza validazione
  formato. Cambiato in `Optional[datetime]`; Pydantic valida la data automaticamente.

- **🟡 `datetime.utcnow()` deprecato (Python 3.12+)**: sostituito con
  `datetime.now(timezone.utc)` in `game_config.py` e `plugin_base.py`.

- **🟡 `settings.py`**: import `datetime`, `timezone`, `aiomysql`, `hash_password`
  erano dentro la funzione `initial_setup`. Spostati a livello modulo.

#### Sicurezza migliorata

- **`security.py` X-Forwarded-For spoofable**: `_extract_client_ip` si fidava
  incondizionatamente dell'header `X-Forwarded-For`, permettendo a qualsiasi client
  di impersonare un IP diverso per aggirare il rate-limiter o la IP allowlist. Ora
  i forwarded-for header sono ignorati se il peer diretto non è in `_TRUSTED_PROXY_IPS`
  (default: `127.0.0.1`, `::1`). Aggiungere l'IP di nginx/load-balancer se necessario.

- **`config.py`**: default `DEBUG: bool = True` → `DEBUG: bool = False`. In DEBUG
  mode venivano esposti `/docs`, `/redoc`, SQL echo e rate limit allentato.

#### Architettura migliorata

- **`serverforge.py` `import_machine`**: usava `pymysql` raw con connessione autonoma,
  bypassando il transaction lifecycle di SQLAlchemy e la dependency `get_db`.
  Refactored: ora usa l'async session standard, identico agli altri route handler.
  Eliminati import lazy `import pymysql` e `from app.core.encryption import ...`
  dentro la funzione.

- **`store.py`**: rimosso ternary `DictCursor` complesso e sempre-falso. Sostituito con
  `pymysql.cursors.DictCursor` diretto. `import pymysql.cursors` spostato a livello
  modulo. Frozenset `_ALLOWED_COLUMNS` spostato a livello modulo come
  `_USER_ALLOWED_COLUMNS` (era ricreato ad ogni chiamata a `update_user`).

- **`machines.py`, `containers.py`, `game_config.py`**: estratto `_ssh_for_machine()`
  centralizzato che propaga `server_settings.SSH_TIMEOUT`. Prima il timeout SSH
  di `.env` veniva ignorato nella maggior parte dei call site.

- **`db/models/app.py`**: `AppSetting.value` cambiato da `Text` (65 KB) a
  `MEDIUMTEXT` (16 MB) per corrispondere al tipo reale nel DB live. Il campo
  `containers_map` può superare 65 KB su cluster grandi.

- **Import lazy rimossi** da `settings.py` e `serverforge.py`.

#### Migration richiesta

```
deploy/migrations/001_arkmania_config_unique.sql
```
Da eseguire una volta sul database live prima del prossimo riavvio del backend.

---

## [2.2.0] - 2026-03-24

### Architettura: Vault rimosso → .env + DB

#### Rimosso
- **Vault criptato locale** (`arkmaniagest.vault`) — non piu' necessario
- **Schermata Unlock** — il backend parte direttamente senza master password
- **Pulsante "Blocca Vault"** dalla sidebar
- `vault.py`, `UnlockScreen.tsx`, `vaultApi` dal frontend

#### Aggiunto
- **`.env`** come unica fonte per credenziali DB, JWT secret, encryption key, SF token
- **`encryption.py`** — AES-256-GCM per criptare campi sensibili (password SSH) nel DB
- **`store.py`** — layer di accesso dati (sync + async) che sostituisce il vault
- **3 nuove tabelle DB**: `arkmaniagest_users`, `arkmaniagest_machines`, `arkmaniagest_settings`
- **`setup_no_vault.py`** — script di setup/migrazione che crea tabelle, utente admin, e .env
- Auto-generazione `JWT_SECRET` e `FIELD_ENCRYPTION_KEY` al primo avvio se assenti
- Auto-creazione tabelle `arkmaniagest_*` al boot via SQLAlchemy `create_all`
- Endpoint `GET /settings/status` (sostituisce `/settings/vault/status`)
- Endpoint `POST /settings/setup` (setup semplificato, solo creazione admin)

#### Modificato
- **`config.py`** — legge `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, `SF_TOKEN` dal `.env`
- **`auth.py`** — JWT secret dal `.env`, utenti da `arkmaniagest_users` (DB)
- **`session.py`** — URL database dal config, `create_app_tables()` al boot
- **`main.py`** — lifespan asincrono (startup: init encryption + DB + tabelle; shutdown: chiudi DB)
- **`machines.py`** — CRUD su tabella `arkmaniagest_machines` con password SSH criptate AES-256-GCM
- **`settings.py`** — impostazioni app da `arkmaniagest_settings`, DB config in sola lettura
- **`serverforge.py`** — token da `.env` (non piu' aggiornabile da API)
- **`containers.py`**, **`players.py`**, **`plugin_base.py`**, **`game_config.py`** — migrati da vault a `store.py`
- **Frontend**: rimosso flusso vault/unlock, setup wizard semplificato (solo creazione admin), sidebar senza Lock
- **Rate limiter** — path aggiornati (`/auth/login`, `/settings/setup`)

#### Sicurezza
- Password SSH: criptate AES-256-GCM nel DB (nonce random 12 bytes per ogni encrypt)
- Password utenti: bcrypt (invariato)
- JWT secret: 256 bit, generato automaticamente, nel `.env`
- `.env` in `.gitignore` — unico file da proteggere sul server
- Nessun dato sensibile mai in chiaro nel DB (campo `ssh_password_enc`)
- Il backend non richiede piu' interazione umana per avviarsi

### Giocatori
- **Colonna Tribu'** ripristinata nella tabella giocatori come colonna separata con sorting
- **Ultimo login** mostra anche tempo relativo (es. "5g fa", "3h fa")
- Correzione query: tribù ora da `arkmania_player_tribes` + `arkmania_tribe_decay` (non piu' da player_name)
- Stats `players_with_points` corretto: esclude orfani ArkShopPlayers senza record in Players

### Decay Manager
- Tab Pending: colonna "Nome" sostituita con "Motivo" (orphaned/expired) + server name da `arkmania_servers`
- Tab Tribes: `last_refresh_name` risolto via JOIN a `Players` + `arkmania_player_history`
- Ricerca tribes espansa: cerca anche in `Players.Giocatore` e `arkmania_player_history.player_name`

---

## [2.1.0] - 2026-03-23

### Migrazione Plugin: Lethal → ArkMania (DB-centralizzato)

#### Aggiunto
- **ArkMania Config Editor** — pagina unica per gestire tutti i moduli plugin (Login, Plus, RareDino, ItemPlus, ServerRules, DeadSaver, CrossChat, DecayManager, Discord, Messages) con sidebar moduli, selector server per override, salvataggio bulk
- **Ban Manager** — CRUD ban cluster-wide su `arkmania_bans` con ricerca, creazione, sblocco
- **Rare Dinos** — gestione pool dino rari su `arkmania_rare_dinos` con editing stat inline, toggle abilitazione, log spawn
- **Transfer Rules** — gestione regole trasferimento su `arkmania_transfer_rules` con livelli (full/survivor/blocked)
- 4 nuovi backend router sotto `/api/v1/arkmania/*`
- Connessione diretta al DB `arkmania` via MCP MySQL

#### Rimosso
- **Tutti i plugin Lethal** — LethalSightings, LethalLogin, LethalDecay, LethalQuests, LethalDinoUtilities, NoBuildSpawn, ItemsPlus (vecchio)
- `plugin_base.py` + `GenericPluginPage.tsx` (architettura SSH pull/push JSON)
- `plugins.py` + `config_manager.py` + `quest_generator.py`
- Pagina Decadimento Tribu' (ora gestita dal modulo DecayManager in arkmania_config)
- Modelli ORM `LethalDecayTribe` e `LethalLoginServer`
- Tipi TS `DecayTribeItem` e `DecayStats`
- Schema `decay.py`

#### Architettura
- I plugin ArkMania usano un'architettura **DB-centralizzata**: tutti i setting sono in `arkmania_config` (chiave-valore con `server_key='*'` globale e override per server specifico)
- I plugin C++ leggono dal DB via `ConfigDB::GetString/GetBool/GetInt`
- Il `config.json` locale sui server contiene SOLO le credenziali MySQL
- 11 server auto-registrati in `arkmania_servers` con heartbeat

---

## [2.0.0-alpha] - 2026-03-17

### Autenticazione Multi-Utente
- **Login JWT** con username e password (token 24h)
- **3 ruoli**: Admin (tutto), Operatore (gestione giocatori/server), Viewer (solo lettura)
- **Gestione utenti** da pagina dedicata (solo admin)
- Primo utente admin creato durante il setup wizard
- Migrazione automatica vault pre-2.0 (crea admin/admin)
- Sidebar mostra utente corrente con avatar e ruolo
- Tutte le route API protette da JWT
- Rate limiting su endpoint auth (10 req/min + blocco IP)

### Container & SSH
- **Pagina Container** — scansione automatica container di gioco via SSH
- Discovery percorsi: ShooterGame, SavedArks, Plugin, Config INI, Logs
- Visualizzatore file remoto e file browser navigabile
- **Sync nomi giocatori** da .arkprofile — estrae nomi dal binario UE5
- Pannello sync con tabella container e conteggio profili per server

### ArkShop Editor
- **Dialog modale** per editing shop items, kits, sell items
- **Ricerca Blueprint** dall'anagrafica locale nel campo Blueprint
- Layout a righe (non più card griglia)
- Sezioni MySQL e General complete con tutti i campi
- Editor sub-items con aggiunta/rimozione Item e Comando

### Giocatori
- Colonna **Permessi Temporanei** nella tabella con chip viola/rosso
- Filtro gruppi cerca anche nei permessi temporanei
- **Ordinamento per colonna** cliccabile (nome, punti, gruppi, temporanei, login)

### Blueprint DB
- Download da Dododex GitHub con test connessione
- Endpoint debug e gestione errori migliorata

---

## [1.0.0-beta] - 2026-03-06

### Tema & UI
- **Redesign completo Light Professional Blue** — tema chiaro con toni blu, card bianche con ombre sottili, tipografia Plus Jakarta Sans
- Sidebar bianca con navigazione pulita e sezioni separate (Principale / Impostazioni)
- Tabella giocatori con bordi continui, colonne fisse, avatar con gradiente blu
- Chips permessi con bordi definiti, badge colorati per stato
- Setup Wizard con sfondo gradiente azzurro

### ServerForge
- **Dashboard ServerForge** — monitoraggio macchine (CPU/RAM/Disco), server di gioco con controlli Start/Stop/Restart, cluster
- **Import macchine da ServerForge** — pannello nella pagina Macchine SSH per importare con credenziali inline
- Token ServerForge facoltativo nel setup wizard (step 3)
- Proxy backend per tutte le chiamate API ServerForge (token mai esposto al frontend)

### Giocatori
- **Pannello gestione giocatori** — tabella con ricerca, filtro per gruppo, statistiche (totale, punti, spesi)
- Dettaglio giocatore con split panel: info, tribu, ultimo login, totale speso
- **Punti Shop** — imposta valore assoluto o aggiungi/sottrai con bottoni rapidi (+100/+500/+1000/-100)
- **Permessi Fissi** — toggle per ogni gruppo definito nel DB con salvataggio diretto
- **Permessi Temporanei** — editor per riga con formato `flag;timestamp;NomeGruppo`, datepicker per scadenza, pulsanti estensione +1m/+3m/+12m, badge Attivo/Scaduto

### Macchine SSH
- Validazione form con errori inline, duplicazione, card espandibili
- Import da ServerForge con confronto hostname/IP per evitare duplicati

### Infrastruttura
- **PM2** — gestione processi con `ark.bat` (setup/start/stop/restart/logs/status)
- Wrapper Node per backend e frontend senza console visibili su Windows
- Modelli ORM per tabelle ARK esistenti (Players, ArkShopPlayers, PermissionGroups, TribePermissions, LethalDecayTribe)
- Auto-init motore DB allo sblocco del vault

---

## [0.2.0] - 2026-03-06

### Aggiunto
- **Vault criptato locale** — Storage sicuro per tutta la configurazione dell'app
- **Setup Wizard** — creazione vault + configurazione DB + SSH
- **Schermata Unlock** — sblocco vault con master password ad ogni avvio

---

## [0.1.0] - 2026-03-06

### Aggiunto
- **Struttura progetto** — Scaffolding completo backend (FastAPI) + frontend (React)
- **README.md** — Documentazione iniziale
- **CHANGELOG.md** — Storico delle modifiche

---

## Roadmap

| Versione | Milestone                              | Target        |
|----------|----------------------------------------|---------------|
| 0.1.0    | Scaffolding + struttura progetto       | ✅ Marzo 2026 |
| 0.2.0    | Database + modelli + CRUD base         | ✅ Marzo 2026 |
| 0.3.0    | Modulo SSH/SCP funzionante             | ✅ Marzo 2026 |
| 0.4.0    | Gestione plugin e config editor        | ✅ Marzo 2026 |
| 0.5.0    | Frontend dashboard + pagine principali | ✅ Marzo 2026 |
| 1.0.0    | Release stabile completa               | Aprile 2026   |
