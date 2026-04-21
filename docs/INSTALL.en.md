# ArkManiaGest — Installation guide (English)

This guide walks you through installing the ArkManiaGest admin panel
from a release bundle downloaded from GitHub.  Follow these steps if
you want to deploy the panel yourself on your own Linux VPS.

> **Licensing reminder**: ArkManiaGest is **source-available, not open
> source**.  The code is public for transparency and evaluation, but
> any deployment — commercial or not — requires **prior written
> authorisation** from Lomatek / ArkMania.it.  Write to
> `info@arkmania.it` to request it.  See [LICENSE](../LICENSE).

---

## Architecture at a glance

```
┌──────────────────────────────┐        SSH (port 22)        ┌────────────────┐
│  Your PC (Windows or Linux)  │ ──────────────────────────► │ Linux VPS       │
│  — download the release zip  │   install-panel.ps1/.sh     │ (panel host)    │
│  — run install-panel.*       │                             │ OpenSSH only    │
└──────────────────────────────┘                             └────────────────┘
                                                                    │
                                                                    │ SSH
                                                                    ▼
                                                        ┌────────────────────────┐
                                                        │ Game hosts (N boxes)   │
                                                        │ Linux or Windows+WSL   │
                                                        │ running POK-manager    │
                                                        │ Docker containers with │
                                                        │ ARK: Survival Ascended │
                                                        └────────────────────────┘
```

- The **client** (the PC you run the installer from) can be Windows or
  Linux — it only needs `ssh`, `scp`, `tar` (standard on Windows 10/11
  and any modern Linux).
- The **panel host** is a Linux VPS (Debian 11+ / Ubuntu 22.04+) with
  only OpenSSH pre-installed.  The installer sets up everything else
  automatically: Python, Node, MariaDB (optional), Nginx, Let's
  Encrypt, UFW, Fail2ban, systemd.
- **Game hosts** are added later from the panel UI; they can be any
  mix of native Linux and Windows + WSL2 + Ubuntu.

---

## Prerequisites

### On your PC (the client)

| Platform | Requirements |
|----------|--------------|
| Windows 10/11 | PowerShell 5.1+ (bundled), OpenSSH client (bundled since Win10 1809) |
| Linux | `bash`, `ssh`, `scp`, `tar`, `curl`, `openssl`, `base64`  (all standard) |

No other packages are needed.  No Python / Node / Docker on the client.

### On the target server (the VPS)

- Debian 11+ or Ubuntu 22.04+ (other distros may work but are not
  tested by the installer).
- A **sudo-capable** SSH user (typically `root` or a user in the
  `sudo`/`wheel` group).
- **DNS**: the public domain you want to use (e.g. `panel.example.com`)
  must already point to the server's public IP.  Let's Encrypt
  validates ownership via HTTP on port 80 during install.
- Open **inbound ports**: 22 (SSH), 80 (HTTP → redirected to HTTPS),
  443 (HTTPS).
- Internet access (for `apt` + certbot + Steam tools when you later
  add game hosts).

### On the Windows host you want to use as panel host (not supported directly)

If you want to run the panel itself on a Windows VPS, install **WSL2**
with an Ubuntu distribution and point the installer at that.  See the
"Panel on a Windows server" section of the main [README.md](../README.md).

---

## Step 1 — Download the release

1. Go to
   [https://github.com/Mrtritolo/ArkManiaGest/releases/latest](https://github.com/Mrtritolo/ArkManiaGest/releases/latest)
2. Download the archive that matches your **client** OS:
   - **Windows client** → `arkmaniagest-vX.Y.Z-windows.zip`
   - **Linux client** → `arkmaniagest-vX.Y.Z-linux.tar.gz`
3. Verify the checksum against `SHA256SUMS.txt` (optional but
   recommended).

## Step 2 — Extract

### Windows

```powershell
Expand-Archive arkmaniagest-vX.Y.Z-windows.zip -DestinationPath .
cd arkmaniagest-vX.Y.Z
```

### Linux

```bash
tar -xzf arkmaniagest-vX.Y.Z-linux.tar.gz
cd arkmaniagest-vX.Y.Z
```

## Step 3 — Run the installer

### Windows client

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\install-panel.ps1
```

### Linux client

```bash
bash ./deploy/install-panel.sh
```

### What the installer asks

The installer is interactive.  It prompts for:

1. **Target server address** (IP or hostname).
2. **SSH user** + **SSH port** (default `22`).
3. **SSH auth**: the installer first probes whether SSH already works
   using your default keys / `ssh-agent`.  If yes, no auth prompt is
   required.  Otherwise it asks whether to use a key file (prompting
   for the path) or a password.
4. **Public domain** for the panel (e.g. `panel.example.com`).
5. **Admin email** for Let's Encrypt notifications.
6. **MariaDB**:
   - "Install MariaDB on the target?" — pick **yes** for a
     self-contained install.  Pick **no** if you already have a
     MariaDB server you want the panel to reuse.
   - Database name, user, password.  Leave the password blank to
     auto-generate a random one (it is saved into the server's
     `.env` file).
7. **Admin user / display name / password** for the panel web UI.

After you confirm, the installer:

- Tests SSH connectivity and sudo.
- Generates `deploy.conf` + `backend/.env` locally (with random
  `JWT_SECRET`, `FIELD_ENCRYPTION_KEY`, etc.).
- `scp`s the release tarball to `/tmp/` on the server.
- Runs `deploy/full-deploy.sh` on the remote host (apt, Python venv,
  Node build, Nginx, Let's Encrypt, UFW, Fail2ban, systemd).
- Seeds the initial admin user via the `/settings/setup` endpoint.

Expect ~5–10 minutes from prompt to panel online.

## Step 4 — Post-install verification

```bash
# Service is up
sudo systemctl status arkmaniagest

# Health endpoint reachable
curl -sf https://<your-domain>/health

# Database sanity check
sudo -u arkmania /opt/arkmaniagest/backend/venv/bin/python \
    /opt/arkmaniagest/deploy/test_db.py
```

Open `https://<your-domain>` in your browser and log in with the admin
user you chose during install.

## Step 5 — Add game-server machines

From **Machines → New SSH machine** in the panel UI:

1. Pick host OS (Linux / Windows + WSL) — sidebar badge mirrors the
   choice.
2. Enter SSH host, port, user, and key or password.
3. Click **Test connection**.
4. The panel stores the credentials encrypted (AES-256-GCM) in its
   database.

The Docker / POK-manager orchestration UI ships in the next release
(v2.4).  Today you can already scan existing containers,
inspect the filesystem, edit `Game.ini` / `GameUserSettings.ini`, and
administer players via RCON once the bootstrap endpoint lands.

---

## Updating to a newer release

Re-run the same installer — it is idempotent.  `backend/.env` is
preserved, and `deploy/migrate-env.sh` backfills any new keys added by
the newer release.

Alternative (incremental, no package reinstall):

```powershell
.\deploy\update-remote.ps1                 # full sync
.\deploy\update-remote.ps1 -BackendOnly
.\deploy\update-remote.ps1 -FrontendOnly
```

You can also see which version is running **and** whether a newer
release is available from the panel itself: **Settings → General →
Updates → Check now**.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `SSH test failed` | `ssh user@host` manually first; fix key permissions (`chmod 600`) or password before re-running. |
| `Let's Encrypt failed` | Check DNS resolves to the server IP and port 80 is reachable from the public internet. |
| `MariaDB access denied` | If you answered "no" to "install MariaDB", ensure the DB you gave exists and the user has full privileges on the panel schema. |
| Panel 502 Bad Gateway | `sudo systemctl status arkmaniagest` + `journalctl -u arkmaniagest -n 50` for the underlying error. |
| `update-remote.ps1` prompts for password on every push | Set up an SSH key on the target: `ssh-copy-id user@host` (or install a key manually). |

For security issues, follow [SECURITY.md](../SECURITY.md) — do **not**
open a public GitHub issue for vulnerabilities.

---

## Uninstalling

```bash
sudo systemctl disable --now arkmaniagest
sudo rm -rf /opt/arkmaniagest /var/log/arkmaniagest /etc/systemd/system/arkmaniagest.service
sudo rm -f /etc/nginx/sites-enabled/arkmaniagest /etc/nginx/sites-available/arkmaniagest
sudo systemctl reload nginx
# Optional: drop the MariaDB database + user
```
