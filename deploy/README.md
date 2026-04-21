# ArkManiaGest — Production Deploy Guide

## Configuration

All deploy parameters are centralized in **`deploy.conf`**. Edit this file before deploying:

```bash
# deploy/deploy.conf
DEPLOY_SERVER="root@YOUR_SERVER_IP"
DOMAIN="your-domain.example.com"
SSL_EMAIL="admin@example.com"
APP_DIR="/opt/arkmaniagest"
APP_USER="arkmania"
```

---

## Deploy from PC (Windows)

### First deploy (full setup)

```powershell
.\deploy\deploy-remote.ps1
```

Runs: upload archive → `full-deploy.sh` on server (packages, user, venv, npm build, nginx, SSL, GeoIP, UFW, fail2ban, cron).

### Code update

```powershell
# Full update
.\deploy\update-remote.ps1

# Backend only
.\deploy\update-remote.ps1 -BackendOnly

# Frontend only
.\deploy\update-remote.ps1 -FrontendOnly

# Force dependency reinstall
.\deploy\update-remote.ps1 -WithDeps

# Skip dependencies (files only)
.\deploy\update-remote.ps1 -NoDeps

# Preview without executing
.\deploy\update-remote.ps1 -DryRun
```

---

## Server Management

### Status
```bash
bash /opt/arkmaniagest/deploy/status.sh
```

### Logs
```bash
tail -f /var/log/arkmaniagest/backend.log
tail -f /var/log/nginx/access.log
journalctl -u arkmaniagest -f
```

### Restart
```bash
sudo systemctl restart arkmaniagest
sudo systemctl reload nginx
```

### Backup / Restore
```bash
sudo bash /opt/arkmaniagest/deploy/backup.sh
ls -lh /opt/arkmaniagest-backups/
sudo bash /opt/arkmaniagest/deploy/restore.sh <file.tar.gz>
```

### SSL
```bash
sudo bash /opt/arkmaniagest/deploy/setup-ssl.sh your-domain.example.com
```

### Cron
```bash
sudo bash /opt/arkmaniagest/deploy/setup-cron.sh
crontab -l
```

---

## File Reference

| File | Role |
|---|---|
| `deploy.conf` | **Shared config** — single source of truth for all parameters |
| `update-remote.ps1` | **PC** — Incremental update (tar + scp + server-update.sh) |
| `deploy-remote.ps1` | **PC** — Full initial deploy (tar + scp + full-deploy.sh) |
| `server-update.sh` | **Server** — Executed by update-remote.ps1 (sync, deps, build, restart) |
| `full-deploy.sh` | **Server** — Full setup (packages, nginx, SSL, firewall, cron) |
| `backup.sh` | **Server** — Backup .env + nginx config |
| `restore.sh` | **Server** — Restore from backup |
| `status.sh` | **Server** — Service health check |
| `setup-ssl.sh` | **Server** — Let's Encrypt certificate setup |
| `setup-cron.sh` | **Server** — Install cron jobs (backup, health, name sync) |
| `cron-sync-names.sh` | **Server** — Player name sync from .arkprofile (daily cron) |
| `.env.production` | Environment variable template |
| `arkmaniagest.service` | Systemd unit file |
| `nginx-initial.conf` | Nginx HTTP config (pre-SSL, uses `__DOMAIN__` placeholder) |
| `nginx-production.conf` | Nginx HTTPS + GeoIP config (uses `__DOMAIN__`, `__APP_DIR__`, `__PUBLIC_ORIGIN__` placeholders) |
| `geoip2.conf` | GeoIP2 module config (uses `__GEOIP_COUNTRIES__`, `__GEOIP_WHITELIST__` placeholders) |
| `fail2ban-filter.conf` | Fail2ban auth brute-force filter |
| `fail2ban-jail.conf` | Fail2ban jail definitions |
| `.deployignore` | Exclusion list for deployment archives |
| `test_db.py` | Diagnostic: test DB connectivity and machine decryption |

---

## Environment Variables (backend/.env)

### Panel DB (required — ArkManiaGest own data)

| Variable | Default | Description |
|---|---|---|
| `API_HOST` | `127.0.0.1` | Bind address (behind Nginx) |
| `API_PORT` | `8000` | API port |
| `DEBUG` | `false` | Never `true` in production |
| `CORS_ORIGINS` | `["https://..."]` | Allowed frontend origins (JSON array) |
| `DB_HOST` | `localhost` | Panel MariaDB host |
| `DB_PORT` | `3306` | Panel MariaDB port |
| `DB_NAME` | `arkmaniagest` | Panel database name |
| `DB_USER` | `admin` | Panel database user |
| `DB_PASSWORD` | — | Panel database password (required) |
| `JWT_SECRET` | (auto) | Auto-generated on first startup |
| `FIELD_ENCRYPTION_KEY` | (auto) | Auto-generated on first startup |
| `PUBLIC_API_KEY` | — | API key for public endpoints |
| `CRON_SECRET` | — | Secret for cron-triggered endpoints |
| `PUBLIC_ALLOWED_ORIGINS` | — | Comma-separated origins for public API |
| `PUBLIC_SERVER_IPS` | — | Comma-separated server IPs for cron access |

### Plugin DB (optional — ArkMania game plugin data)

Each empty value falls back to the corresponding `DB_*` above, so single-
database installations keep working with no changes.

| Variable | Description |
|---|---|
| `PLUGIN_DB_HOST` | Plugin MariaDB host — typically on the game host |
| `PLUGIN_DB_PORT` | Plugin MariaDB port |
| `PLUGIN_DB_NAME` | Plugin database name (e.g. `arkmania`) |
| `PLUGIN_DB_USER` | Plugin database user |
| `PLUGIN_DB_PASSWORD` | Plugin database password |

Tables that live in the **Panel DB**: `arkmaniagest_users`,
`arkmaniagest_machines`, `arkmaniagest_settings`, and — starting from the
next phase — `ARKM_server_instances`, `ARKM_instance_actions`,
`ARKM_mariadb_instances`.

Tables that live in the **Plugin DB**: all `ARKM_config` / `ARKM_bans` /
`ARKM_rare_dinos` / `ARKM_rare_spawns` / `ARKM_transfer_rules` /
`ARKM_players` / `ARKM_player_tribes` / `ARKM_tribe_decay` /
`ARKM_decay_pending` / `ARKM_decay_log` / `ARKM_lb_scores` / `ARKM_lb_events`
/ `ARKM_sessions` / `ARKM_event_log` / `ARKM_servers` + the native ARK
tables `Players`, `ArkShopPlayers`, `PermissionGroups`, `TribePermissions`.

Run `deploy/test_db.py` on the server to verify both connections and
that the core tables are reachable.

---

## Security

- **Secrets in .env** — `JWT_SECRET` and `FIELD_ENCRYPTION_KEY` auto-generated by `ensure_secrets()`, never committed
- **Rate limiting** — 120 req/min API, 10 req/min auth
- **IP blocking** — Fail2ban on SSH and Nginx
- **Security headers** — CSP, HSTS, X-Frame-Options, nosniff
- **UFW firewall** — SSH + HTTP/HTTPS only
- **GeoIP** — configurable country allowlist + IP whitelist
- **Systemd hardening** — NoNewPrivileges, ProtectSystem, PrivateTmp
- **HTTPS** — Let's Encrypt with auto-renewal
- **Automatic backup** — .env + config daily (cron 03:00)
- **Health check** — every 5 min, auto-restart if down
