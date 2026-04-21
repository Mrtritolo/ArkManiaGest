# ServerForge API — Analisi Completa della Documentazione Ufficiale

> **Versione API:** v0.0.1 (OpenAPI 3.1.0)  
> **Base URL:** `https://serverforge.cx/api`  
> **Autenticazione:** Bearer Token (`Authorization: Bearer <TOKEN>`)  
> **Documentazione:** `https://serverforge.cx/docs/api#/` (richiede login web)  
> **Powered by:** Stoplight

---

## Riepilogo Endpoint

L'API espone **6 endpoint GET** raggruppati sotto il tag `UserResource`, tutti in sola lettura. Inoltre, tramite esplorazione diretta, sono stati individuati **3 endpoint POST** per le azioni sui container (start/stop/restart) e 1 endpoint GET aggiuntivo per lo status rapido.

| # | Metodo | Endpoint | Descrizione |
|---|--------|----------|-------------|
| 1 | GET | `/user/machines` | Lista tutte le macchine accessibili |
| 2 | GET | `/user/containers` | Lista tutti i container accessibili |
| 3 | GET | `/user/clusters` | Lista tutti i cluster accessibili |
| 4 | GET | `/machines/{machine}` | Dettaglio di una macchina specifica |
| 5 | GET | `/containers/{container}` | Dettaglio di un container specifico |
| 6 | GET | `/clusters/{cluster}` | Dettaglio di un cluster specifico |
| 7* | GET | `/containers/{container}/status` | Stato rapido del container |
| 8* | POST | `/containers/{container}/start` | Avvia il container |
| 9* | POST | `/containers/{container}/stop` | Ferma il container |
| 10* | POST | `/containers/{container}/restart` | Riavvia il container |

> *Gli endpoint 7-10 sono stati scoperti tramite esplorazione e non sono (ancora) nella documentazione ufficiale.*

---

## Autenticazione

Tutti gli endpoint richiedono un Bearer Token nell'header HTTP.

```
Authorization: Bearer <TOKEN>
Accept: application/json
```

**Codici di errore:**
- `401 Unauthenticated` — Token mancante o non valido
- `403 Unauthorized` — Permessi insufficienti
- `404 Not found` — Risorsa non trovata

---

## 1. GET /user/machines

**Descrizione:** Restituisce tutte le macchine fisiche (server dedicati) a cui l'utente ha accesso.

### Campi risposta

| Campo | Tipo | Obbligatorio | Descrizione |
|-------|------|:---:|-------------|
| `success` | boolean | ✅ | Esito della richiesta |
| `data` | array[object] | ✅ | Lista macchine |
| `total_count` | integer (≥0) | ✅ | Numero totale macchine |

### Oggetto Machine (nella lista)

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | integer | ID univoco macchina |
| `hostname` | string / null | Nome host |
| `ip_address` | string / null | Indirizzo IP |
| `status` | string | Stato della macchina |
| `os` | string | Sistema operativo |
| `cpu_usage_percent` | string / null | Utilizzo CPU (%) |
| `ram_usage_percent` | string / null | Utilizzo RAM (%) |
| `ram_total_gb` | string / null | RAM totale (GB) |
| `ram_used_gb` | string / null | RAM usata (GB) |
| `disk_usage_percent` | string / null | Utilizzo disco (%) |
| `disk_total_gb` | string / null | Disco totale (GB) |
| `disk_used_gb` | string / null | Disco usato (GB) |
| `location` | string | Posizione del server |
| `coordinates` | string | Coordinate geografiche |
| `containers_count` | integer (≥0) | Numero container sulla macchina |
| `clusters_count` | integer (≥0) | Numero cluster sulla macchina |
| `is_owner` | boolean | Se l'utente è proprietario |

### Esempio richiesta

```bash
curl -X GET "https://serverforge.cx/api/user/machines" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Accept: application/json"
```

---

## 2. GET /user/containers

**Descrizione:** Restituisce tutti i container (server di gioco) accessibili dall'utente autenticato.

### Campi risposta

| Campo | Tipo | Obbligatorio | Descrizione |
|-------|------|:---:|-------------|
| `success` | boolean | ✅ | Esito della richiesta |
| `data` | array[object] | ✅ | Lista container |
| `total_count` | integer (≥0) | ✅ | Numero totale container |

### Oggetto Container (nella lista)

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | integer | ID univoco container |
| `label` | string / null | Nome/etichetta del server |
| `container_name` | string | Nome tecnico del container |
| `status` | string | Stato: `running`, `stopped` |
| `server_port` | integer / null | Porta del server di gioco |
| `rcon_port` | integer / null | Porta RCON |
| `max_players` | integer / null | Numero massimo giocatori |
| `map_name` | string / null | Nome della mappa |
| `uptime` | integer | Uptime in minuti |
| `formatted_uptime` | string | Uptime formattato (es. "7.7 hrs") |
| `build_id` | integer / null | Build ID del gioco |
| `update_available` | boolean | Aggiornamento disponibile |
| `auto_update` | boolean | Auto-update abilitato |
| `machine` | object / null | `{ id, hostname, ip_address }` |
| `game` | object / null | `{ id, name }` |
| `cluster` | object / null | `{ id, name }` |
| `owner` | object / null | `{ id, name }` |
| `mods` | array[ContainerModResource] | Lista mod installate |
| `current_live_stats` | ContainerLiveStats / null | Statistiche live |
| `is_owner` | boolean | Se l'utente e' proprietario |
| `permissions` | array[string] | Permessi dell'utente |

### Esempio richiesta

```bash
curl -X GET "https://serverforge.cx/api/user/containers" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Accept: application/json"
```

---

## 3. GET /user/clusters

**Descrizione:** Restituisce tutti i cluster accessibili dall'utente autenticato.

### Oggetto Cluster (nella lista)

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | integer | ID univoco cluster |
| `name` | string | Nome del cluster |
| `cluster_id` | string / null | Identificativo interno |
| `cluster_dir_override` | string / null | Override directory cluster |
| `sync_enabled` | boolean | Sincronizzazione attiva |
| `syncthing_folder_id` | string / null | ID cartella Syncthing |
| `machine` | object / null | `{ id, hostname, ip_address }` |
| `primary_machine` | object / null | `{ id, hostname, ip_address }` |
| `containers_count` | integer (≥0) | Numero container |
| `sync_members_count` | integer (≥0) | Numero membri sync |
| `is_machine_owner` | string | Se e' proprietario della macchina |

---

## 4. GET /machines/{machine}

**Descrizione:** Restituisce i dettagli completi di una macchina specifica.

**Parametro path:** `machine` (integer, obbligatorio) — L'ID della macchina

### Campi aggiuntivi (rispetto alla lista)

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `ssh_port` | integer | Porta SSH |
| `ram_available_gb` | string / null | RAM disponibile (GB) |
| `disk_free_gb` | string / null | Disco libero (GB) |
| `steamcmd_installed` | string | SteamCMD installato |
| `docker_installed` | string | Docker installato |
| `mariadb_installed` | string | MariaDB installato |
| `health_service_installed` | string | Health service installato |
| `country` | string / null | Paese |
| `region` | string / null | Regione |
| `city` | string / null | Citta' |
| `timezone` | string / null | Fuso orario |
| `owner` | object / null | `{ id, name }` |
| `containers` | array | `[{ id, label, status }]` — Lista container |
| `clusters` | array | `[{ id, name }]` — Lista cluster |
| `is_owner` | boolean | Se l'utente e' proprietario |

### Esempio richiesta

```bash
curl -X GET "https://serverforge.cx/api/machines/15" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Accept: application/json"
```

---

## 5. GET /containers/{container}

**Descrizione:** Restituisce il dettaglio completo di un container specifico. Questo e' l'endpoint piu' ricco di informazioni.

**Parametro path:** `container` (integer, obbligatorio) — L'ID del container

### Tutti i campi

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | integer | ID univoco |
| `label` | string / null | Nome del server |
| `machine_id` | integer | ID macchina host |
| `cluster_id` | integer / null | ID cluster |
| `owner_id` | integer / null | ID proprietario |
| `container_name` | string | Nome tecnico container |
| `container_drive` | string | Drive del container |
| `status` | string | Stato (`running` / `stopped`) |
| `game_id` | integer / null | ID del gioco |
| `server_port` | integer / null | Porta server |
| `map_name` | string / null | Nome mappa |
| `rcon_port` | integer / null | Porta RCON |
| `max_players` | integer / null | Max giocatori |
| `question_mark_options` | string / null | Opzioni di avvio `?param` |
| `hyphen_options` | string / null | Opzioni di avvio `-param` |
| `mods_string` | array / null | Lista ID mod |
| `use_game_template_file` | boolean | Usa template Game.ini |
| `use_gus_template_file` | boolean | Usa template GameUserSettings.ini |
| `config_pending` | boolean | Configurazione in attesa |
| `api_installed` | boolean | Agent API installato |
| `api_enabled` | boolean | Agent API attivo |
| `api_installation_status` | string / null | Stato installazione agent |
| `api_installation_progress` | integer | Progresso installazione (0-100) |
| `api_installation_error` | string / null | Errore installazione |
| `api_installed_at` | datetime / null | Data installazione agent |
| `api_version` | string / null | Versione agent |
| `uptime` | integer | Uptime in minuti |
| `formatted_uptime` | string | Uptime formattato |
| `build_id` | integer / null | Build ID gioco |
| `update_available` | boolean | Aggiornamento disponibile |
| `auto_update` | boolean | Auto-update attivo |
| `auto_update_delay_minutes` | integer | Ritardo auto-update (minuti) |
| `container_updating` | boolean | In aggiornamento |
| `container_updater_batch_id` | string / null | Batch ID updater |
| `last_update_check` | datetime / null | Ultimo check aggiornamento |
| `ga_mod_key` | string / null | Chiave mod GameAnalytics |
| `has_discord_webhook` | boolean | Webhook Discord configurato* |
| `has_join_leave_webhook` | boolean | Webhook join/leave attivo |
| `voting_link` | string / null | Link votazione server |
| `created_at` | datetime / null | Data creazione |
| `updated_at` | datetime / null | Ultima modifica |
| `deleted_at` | string / null | Data eliminazione (soft delete) |
| `machine` | object / null | `{ id, hostname, ip_address }` |
| `game` | object / null | `{ id, name }` |
| `cluster` | object / null | `{ id, name }` |
| `owner` | object / null | `{ id, name }` |
| `mods_count` | string / 0 | Numero mod |
| `mods_list` | array[ContainerModResource] | Lista mod dettagliata |
| `current_live_stats` | ContainerLiveStats / null | Statistiche live |
| `is_owner` | boolean | Se e' proprietario |
| `permissions` | array[string] | Permessi utente |

> *Nota: "Webhook URLs excluded from API for security - manage via web UI"*

### Esempio richiesta

```bash
curl -X GET "https://serverforge.cx/api/containers/135" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Accept: application/json"
```

---

## 6. GET /clusters/{cluster}

**Descrizione:** Restituisce il dettaglio completo di un cluster specifico.

**Parametro path:** `cluster` (integer, obbligatorio) — L'ID del cluster

### Campi

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `id` | integer | ID cluster |
| `name` | string | Nome cluster |
| `cluster_id` | string / null | Identificativo interno |
| `cluster_dir_override` | string / null | Override directory |
| `sync_enabled` | boolean | Sincronizzazione attiva |
| `syncthing_folder_id` | string / null | ID cartella Syncthing |
| `machine` | object / null | `{ id, hostname, ip_address }` |
| `primary_machine` | object / null | `{ id, hostname, ip_address }` |
| `containers` | array | `[{ id, label, status, server_port }]` |
| `sync_members` | array | `[{ id, machine_id }]` |
| `is_machine_owner` | string | Se e' proprietario macchina |

---

## Endpoint Non Documentati (scoperti via esplorazione)

### GET /containers/{container}/status

Restituisce lo stato rapido di un container.

```json
{
  "success": true,
  "data": {
    "container_id": 135,
    "status": "running",
    "map_name": "Aberration_WP",
    "is_running": true,
    "is_stopped": false,
    "last_checked": "2026-03-06T13:24:04.137120Z"
  }
}
```

### POST /containers/{container}/start

Avvia un container fermo. Non richiede body.

### POST /containers/{container}/stop

Ferma un container in esecuzione. Non richiede body.

### POST /containers/{container}/restart

Riavvia un container. Non richiede body.

---

## I Tuoi Server Attuali

### Utente
- **Nome:** Alessio Scortichini
- **Email:** info@arkmania.it
- **Importato da ASAManager:** Si

### Cluster: ArkManiaV2 (ID: 21)
**Macchina:** 116.202.196.51 (ID: 15)

| ID | Server | Mappa | Porta | RCON | Stato |
|----|--------|-------|:-----:|:----:|:-----:|
| 133 | Svartalfheim | Svartalfheim_WP | 7777 | — | stopped |
| 135 | Aberration | Aberration_WP | 7779 | 27022 | running |
| 136 | TheCenter | TheCenter_WP | 7780 | — | running |
| 138 | TheIsland | TheIsland_WP | 7782 | 27025 | running |
| 139 | Club Ark | BobsMissions_WP | 7777 | — | running |
| 140 | LostCity | LostCity_WP | 7778 | — | running |
| 155 | (senza nome) | Svartalfheim_WP | 7783 | — | stopped |

---

## Esempi di Codice

### JavaScript (fetch)

```javascript
const TOKEN = 'TUO_TOKEN';
const BASE = 'https://serverforge.cx/api';
const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Accept': 'application/json'
};

// Lista tutti i container
const containers = await fetch(`${BASE}/user/containers`, { headers })
  .then(r => r.json());

// Dettaglio singolo container
const detail = await fetch(`${BASE}/containers/135`, { headers })
  .then(r => r.json());

// Stato rapido
const status = await fetch(`${BASE}/containers/135/status`, { headers })
  .then(r => r.json());

// Riavvia un server
const restart = await fetch(`${BASE}/containers/135/restart`, {
  method: 'POST',
  headers
}).then(r => r.json());
```

### Python (requests)

```python
import requests

TOKEN = 'TUO_TOKEN'
BASE = 'https://serverforge.cx/api'
headers = {
    'Authorization': f'Bearer {TOKEN}',
    'Accept': 'application/json'
}

# Lista container
containers = requests.get(f'{BASE}/user/containers', headers=headers).json()

# Dettaglio container
detail = requests.get(f'{BASE}/containers/135', headers=headers).json()

# Riavvia server
restart = requests.post(f'{BASE}/containers/135/restart', headers=headers).json()
```

---

## Note Importanti

1. **API v0.0.1** — La documentazione e' in fase iniziale. Potrebbero essere aggiunti nuovi endpoint in futuro.
2. **Solo lettura (ufficiale)** — La specifica OpenAPI documenta solo endpoint GET. Le azioni POST (start/stop/restart) esistono ma non sono ancora documentate ufficialmente.
3. **Sicurezza webhook** — Gli URL dei webhook Discord non sono esposti via API per ragioni di sicurezza; vanno gestiti dalla web UI.
4. **Percorsi endpoint** — La documentazione ufficiale usa `/user/machines`, `/user/containers`, `/user/clusters` per le liste. Per i dettagli usa `/machines/{id}`, `/containers/{id}`, `/clusters/{id}` (senza prefisso `/user/`).
5. **Token** — Non condividere il token API pubblicamente; e' collegato al tuo account.
