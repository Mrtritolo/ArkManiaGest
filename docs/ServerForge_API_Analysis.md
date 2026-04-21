# ServerForge API — Complete Analysis of the Official Documentation

> **API version:** v0.0.1 (OpenAPI 3.1.0)
> **Base URL:** `https://serverforge.cx/api`
> **Authentication:** Bearer Token (`Authorization: Bearer <TOKEN>`)
> **Documentation:** `https://serverforge.cx/docs/api#/` (requires web login)
> **Powered by:** Stoplight

---

## Endpoint summary

The API exposes **6 GET endpoints** grouped under the `UserResource` tag,
all read-only.  Direct probing also revealed **3 POST endpoints** for
container actions (start/stop/restart) plus 1 extra GET endpoint for
quick status.

| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 1 | GET | `/user/machines` | List all accessible machines |
| 2 | GET | `/user/containers` | List all accessible containers |
| 3 | GET | `/user/clusters` | List all accessible clusters |
| 4 | GET | `/machines/{machine}` | Details of a specific machine |
| 5 | GET | `/containers/{container}` | Details of a specific container |
| 6 | GET | `/clusters/{cluster}` | Details of a specific cluster |
| 7* | GET | `/containers/{container}/status` | Quick container status |
| 8* | POST | `/containers/{container}/start` | Start the container |
| 9* | POST | `/containers/{container}/stop` | Stop the container |
| 10* | POST | `/containers/{container}/restart` | Restart the container |

> *Endpoints 7–10 were discovered by exploration and are (not yet) in the
> official documentation.*

---

## Authentication

Every endpoint requires a Bearer Token in the HTTP header.

```
Authorization: Bearer <TOKEN>
Accept: application/json
```

**Error codes:**
- `401 Unauthenticated` — Missing or invalid token
- `403 Unauthorized` — Insufficient permissions
- `404 Not found` — Resource not found

---

## 1. GET /user/machines

**Description:** Returns all physical machines (dedicated servers) the
user has access to.

### Response fields

| Field | Type | Required | Description |
|-------|------|:---:|-------------|
| `success` | boolean | ✅ | Request outcome |
| `data` | array[object] | ✅ | Machines list |
| `total_count` | integer (≥0) | ✅ | Total machines count |

### Machine object (in list)

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | Unique machine ID |
| `hostname` | string / null | Host name |
| `ip_address` | string / null | IP address |
| `status` | string | Machine state |
| `os` | string | Operating system |
| `cpu_usage_percent` | string / null | CPU usage (%) |
| `ram_usage_percent` | string / null | RAM usage (%) |
| `ram_total_gb` | string / null | Total RAM (GB) |
| `ram_used_gb` | string / null | Used RAM (GB) |
| `disk_usage_percent` | string / null | Disk usage (%) |
| `disk_total_gb` | string / null | Total disk (GB) |
| `disk_used_gb` | string / null | Used disk (GB) |
| `location` | string | Server location |
| `coordinates` | string | Geographic coordinates |
| `containers_count` | integer (≥0) | Containers on the machine |
| `clusters_count` | integer (≥0) | Clusters on the machine |
| `is_owner` | boolean | Whether the user owns this machine |

### Example request

```bash
curl -X GET "https://serverforge.cx/api/user/machines" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Accept: application/json"
```

---

## 2. GET /user/containers

**Description:** Returns all containers (game servers) accessible by the
authenticated user.

### Response fields

| Field | Type | Required | Description |
|-------|------|:---:|-------------|
| `success` | boolean | ✅ | Request outcome |
| `data` | array[object] | ✅ | Containers list |
| `total_count` | integer (≥0) | ✅ | Total containers count |

### Container object (in list)

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | Unique container ID |
| `label` | string / null | Server name / label |
| `container_name` | string | Technical container name |
| `status` | string | State: `running`, `stopped` |
| `server_port` | integer / null | Game server port |
| `rcon_port` | integer / null | RCON port |
| `max_players` | integer / null | Player cap |
| `map_name` | string / null | Map name |
| `uptime` | integer | Uptime in minutes |
| `formatted_uptime` | string | Formatted uptime (e.g. "7.7 hrs") |
| `build_id` | integer / null | Game build ID |
| `update_available` | boolean | Update available |
| `auto_update` | boolean | Auto-update enabled |
| `machine` | object / null | `{ id, hostname, ip_address }` |
| `game` | object / null | `{ id, name }` |
| `cluster` | object / null | `{ id, name }` |
| `owner` | object / null | `{ id, name }` |
| `mods` | array[ContainerModResource] | Installed mods |
| `current_live_stats` | ContainerLiveStats / null | Live statistics |
| `is_owner` | boolean | Whether the user owns this container |
| `permissions` | array[string] | User permissions |

### Example request

```bash
curl -X GET "https://serverforge.cx/api/user/containers" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Accept: application/json"
```

---

## 3. GET /user/clusters

**Description:** Returns all clusters accessible by the authenticated user.

### Cluster object (in list)

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | Unique cluster ID |
| `name` | string | Cluster name |
| `cluster_id` | string / null | Internal identifier |
| `cluster_dir_override` | string / null | Cluster directory override |
| `sync_enabled` | boolean | Sync active |
| `syncthing_folder_id` | string / null | Syncthing folder ID |
| `machine` | object / null | `{ id, hostname, ip_address }` |
| `primary_machine` | object / null | `{ id, hostname, ip_address }` |
| `containers_count` | integer (≥0) | Containers count |
| `sync_members_count` | integer (≥0) | Sync members count |
| `is_machine_owner` | string | Whether the user owns the machine |

---

## 4. GET /machines/{machine}

**Description:** Returns full details of a specific machine.

**Path parameter:** `machine` (integer, required) — The machine ID

### Extra fields (compared to the list view)

| Field | Type | Description |
|-------|------|-------------|
| `ssh_port` | integer | SSH port |
| `ram_available_gb` | string / null | Available RAM (GB) |
| `disk_free_gb` | string / null | Free disk (GB) |
| `steamcmd_installed` | string | SteamCMD installed |
| `docker_installed` | string | Docker installed |
| `mariadb_installed` | string | MariaDB installed |
| `health_service_installed` | string | Health service installed |
| `country` | string / null | Country |
| `region` | string / null | Region |
| `city` | string / null | City |
| `timezone` | string / null | Time zone |
| `owner` | object / null | `{ id, name }` |
| `containers` | array | `[{ id, label, status }]` — containers list |
| `clusters` | array | `[{ id, name }]` — clusters list |
| `is_owner` | boolean | Whether the user is the owner |

### Example request

```bash
curl -X GET "https://serverforge.cx/api/machines/15" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Accept: application/json"
```

---

## 5. GET /containers/{container}

**Description:** Returns full details of a specific container.  This is
the richest endpoint.

**Path parameter:** `container` (integer, required) — The container ID

### All fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | Unique ID |
| `label` | string / null | Server name |
| `machine_id` | integer | Host machine ID |
| `cluster_id` | integer / null | Cluster ID |
| `owner_id` | integer / null | Owner ID |
| `container_name` | string | Technical container name |
| `container_drive` | string | Container drive |
| `status` | string | State (`running` / `stopped`) |
| `game_id` | integer / null | Game ID |
| `server_port` | integer / null | Server port |
| `map_name` | string / null | Map name |
| `rcon_port` | integer / null | RCON port |
| `max_players` | integer / null | Player cap |
| `question_mark_options` | string / null | `?param` launch options |
| `hyphen_options` | string / null | `-param` launch options |
| `mods_string` | array / null | Mod IDs list |
| `use_game_template_file` | boolean | Use Game.ini template |
| `use_gus_template_file` | boolean | Use GameUserSettings.ini template |
| `config_pending` | boolean | Configuration pending |
| `api_installed` | boolean | Agent API installed |
| `api_enabled` | boolean | Agent API enabled |
| `api_installation_status` | string / null | Agent installation state |
| `api_installation_progress` | integer | Installation progress (0–100) |
| `api_installation_error` | string / null | Installation error |
| `api_installed_at` | datetime / null | Agent installation date |
| `api_version` | string / null | Agent version |
| `uptime` | integer | Uptime in minutes |
| `formatted_uptime` | string | Formatted uptime |
| `build_id` | integer / null | Game build ID |
| `update_available` | boolean | Update available |
| `auto_update` | boolean | Auto-update enabled |
| `auto_update_delay_minutes` | integer | Auto-update delay (minutes) |
| `container_updating` | boolean | Currently updating |
| `container_updater_batch_id` | string / null | Updater batch ID |
| `last_update_check` | datetime / null | Last update check |
| `ga_mod_key` | string / null | GameAnalytics mod key |
| `has_discord_webhook` | boolean | Discord webhook configured* |
| `has_join_leave_webhook` | boolean | Join/leave webhook enabled |
| `voting_link` | string / null | Server voting link |
| `created_at` | datetime / null | Creation date |
| `updated_at` | datetime / null | Last update |
| `deleted_at` | string / null | Deletion date (soft delete) |
| `machine` | object / null | `{ id, hostname, ip_address }` |
| `game` | object / null | `{ id, name }` |
| `cluster` | object / null | `{ id, name }` |
| `owner` | object / null | `{ id, name }` |
| `mods_count` | string / 0 | Mods count |
| `mods_list` | array[ContainerModResource] | Detailed mods list |
| `current_live_stats` | ContainerLiveStats / null | Live statistics |
| `is_owner` | boolean | Whether the user is the owner |
| `permissions` | array[string] | User permissions |

> *Note: "Webhook URLs excluded from API for security — manage via web UI".*

### Example request

```bash
curl -X GET "https://serverforge.cx/api/containers/135" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Accept: application/json"
```

---

## 6. GET /clusters/{cluster}

**Description:** Returns full details of a specific cluster.

**Path parameter:** `cluster` (integer, required) — The cluster ID

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | Cluster ID |
| `name` | string | Cluster name |
| `cluster_id` | string / null | Internal identifier |
| `cluster_dir_override` | string / null | Directory override |
| `sync_enabled` | boolean | Sync active |
| `syncthing_folder_id` | string / null | Syncthing folder ID |
| `machine` | object / null | `{ id, hostname, ip_address }` |
| `primary_machine` | object / null | `{ id, hostname, ip_address }` |
| `containers` | array | `[{ id, label, status, server_port }]` |
| `sync_members` | array | `[{ id, machine_id }]` |
| `is_machine_owner` | string | Whether the user owns the machine |

---

## Undocumented endpoints (discovered by exploration)

### GET /containers/{container}/status

Returns the quick status of a container.

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

Starts a stopped container.  No request body.

### POST /containers/{container}/stop

Stops a running container.  No request body.

### POST /containers/{container}/restart

Restarts a container.  No request body.

---

## Code examples

### JavaScript (fetch)

```javascript
const TOKEN = 'YOUR_TOKEN';
const BASE = 'https://serverforge.cx/api';
const headers = {
  'Authorization': `Bearer ${TOKEN}`,
  'Accept': 'application/json'
};

// List all containers
const containers = await fetch(`${BASE}/user/containers`, { headers })
  .then(r => r.json());

// Single container detail
const detail = await fetch(`${BASE}/containers/135`, { headers })
  .then(r => r.json());

// Quick status
const status = await fetch(`${BASE}/containers/135/status`, { headers })
  .then(r => r.json());

// Restart a server
const restart = await fetch(`${BASE}/containers/135/restart`, {
  method: 'POST',
  headers
}).then(r => r.json());
```

### Python (requests)

```python
import requests

TOKEN = 'YOUR_TOKEN'
BASE = 'https://serverforge.cx/api'
headers = {
    'Authorization': f'Bearer {TOKEN}',
    'Accept': 'application/json'
}

# List containers
containers = requests.get(f'{BASE}/user/containers', headers=headers).json()

# Container detail
detail = requests.get(f'{BASE}/containers/135', headers=headers).json()

# Restart server
restart = requests.post(f'{BASE}/containers/135/restart', headers=headers).json()
```

---

## Important notes

1. **API v0.0.1** — The documentation is still in an early phase.  New
   endpoints may be added in the future.
2. **Read-only (officially)** — The OpenAPI spec only documents GET
   endpoints.  POST actions (start/stop/restart) exist but are not yet
   officially documented.
3. **Webhook security** — Discord webhook URLs are excluded from the
   API for security; manage them from the web UI.
4. **Endpoint paths** — The official docs use `/user/machines`,
   `/user/containers`, `/user/clusters` for the list routes.  For
   details use `/machines/{id}`, `/containers/{id}`, `/clusters/{id}`
   (no `/user/` prefix).
5. **Tokens** — Do not share the API token publicly; it is bound to
   your account.
