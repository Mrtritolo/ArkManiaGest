# =============================================================================
# ArkManiaGest - Interactive panel installer (Windows client)
# =============================================================================
# Installs the ArkManiaGest admin panel on a remote Linux server that has
# only OpenSSH listening (nothing else preinstalled).  Run this from your
# Windows dev PC:
#
#     powershell -ExecutionPolicy Bypass -File .\deploy\install-panel.ps1
#
# The script will prompt for every piece of information it needs (SSH
# target, admin email, domain, MariaDB root password, etc.), writes a
# deploy/deploy.conf + backend/.env on the fly, tar-bundles the release
# tree, uploads it to /tmp on the remote server and launches
# deploy/full-deploy.sh on the remote side.
#
# Requirements on the CLIENT:
#   - PowerShell 5.1 or newer (bundled with Windows)
#   - ssh.exe + scp.exe (Windows 10/11 include OpenSSH out of the box)
#   - A release checkout of ArkManiaGest (deploy/, backend/, frontend/)
#
# Requirements on the TARGET SERVER:
#   - Reachable via SSH (port 22 or custom) with a sudo-capable account
#   - Debian 11+ / Ubuntu 22.04+ (what full-deploy.sh expects)
#   - Internet access (full-deploy.sh does apt install + certbot)
#
# For a Windows server you cannot target this installer directly: install
# WSL2 + Ubuntu on the Windows host first and deploy inside the WSL
# distro (see the README "Panel on Windows via WSL2" section).
# =============================================================================

[CmdletBinding()]
param(
    [switch]$NonInteractive,
    [string]$ConfigFile,
    [switch]$DryRun
)

# NOTE: we deliberately use "Continue" (not "Stop") so that stderr output
# from native tools like ssh.exe / scp.exe (host-key warnings, apt install
# progress, journalctl chatter) does NOT abort the whole script.  Every
# path that must halt on failure calls the explicit `Fail` helper below.
$ErrorActionPreference = "Continue"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Banner {
    Write-Host ""
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host "  ArkManiaGest - Panel installer"                  -ForegroundColor Cyan
    Write-Host "  Target: remote Linux server over SSH"            -ForegroundColor Cyan
    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Ask([string]$question, [string]$default = "", [switch]$secret, [switch]$required) {
    while ($true) {
        if ($default) {
            $prompt = "$question [$default]"
        } else {
            $prompt = $question
        }
        if ($secret) {
            $sec = Read-Host -Prompt $prompt -AsSecureString
            $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
            try {
                $val = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
            } finally {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
            }
        } else {
            $val = Read-Host -Prompt $prompt
        }
        if (-not $val) { $val = $default }
        if ($required -and -not $val) {
            Write-Host "  This value is required." -ForegroundColor Yellow
            continue
        }
        return $val
    }
}

function AskYesNo([string]$question, [bool]$default = $true) {
    $hint = if ($default) { "[Y/n]" } else { "[y/N]" }
    while ($true) {
        $ans = (Read-Host -Prompt "$question $hint").Trim().ToLower()
        if (-not $ans) { return $default }
        if ($ans -in @('y','yes','s','si','sì')) { return $true }
        if ($ans -in @('n','no'))                 { return $false }
    }
}

function New-RandomSecret([int]$bytes = 32) {
    $buf = New-Object byte[] $bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return ($buf | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Fail([string]$msg) {
    Write-Host ""
    Write-Host "  [ABORT] $msg" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# 0. Sanity checks
# ---------------------------------------------------------------------------

$PROJECT = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $PROJECT

Write-Banner

foreach ($tool in @("ssh.exe", "scp.exe", "tar.exe")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Fail "Required tool '$tool' not found in PATH. Install the Windows OpenSSH client and try again."
    }
}
if (-not (Test-Path (Join-Path $PROJECT "deploy\full-deploy.sh"))) {
    Fail "This script must live inside an ArkManiaGest release/source tree (deploy/full-deploy.sh is missing)."
}

# ---------------------------------------------------------------------------
# 1. Interactive prompts
# ---------------------------------------------------------------------------

Write-Host "-- Target server --" -ForegroundColor Cyan
$target_host = Ask "Server address (IP or hostname)" -required
$ssh_user    = Ask "SSH user (must have sudo access)" "root"
$ssh_port    = Ask "SSH port" "22"

$ssh_key_path = ""
$ssh_password = ""

# Try SSH with no explicit auth first -- this succeeds when the user
# already has ssh-agent running OR a default key at ~/.ssh/id_*.  In
# that case we skip the auth prompts entirely.
Write-Host ""
Write-Host "-- Probing SSH (using default keys / ssh-agent) --" -ForegroundColor Cyan

# Handle the common "server was reinstalled, host key changed" case up
# front.  We capture ssh stderr and, if the warning is detected, offer
# to run `ssh-keygen -R <host>` to purge the stale fingerprint and retry.
function Invoke-SSHProbe {
    $probe_args = @(
        "-p", $ssh_port,
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=8"
    )
    $tmp_err = [System.IO.Path]::GetTempFileName()
    try {
        & ssh.exe @probe_args "${ssh_user}@${target_host}" "echo ArkManiaGest-SSH-OK" 1>$null 2>$tmp_err
        $rc = $LASTEXITCODE
        $err = ""
        if (Test-Path $tmp_err) { $err = Get-Content -Raw -Path $tmp_err }
        return @{ rc = $rc; err = $err }
    } finally {
        if (Test-Path $tmp_err) { Remove-Item -Force $tmp_err -ErrorAction SilentlyContinue }
    }
}

$probe = Invoke-SSHProbe
$probe_ok = ($probe.rc -eq 0)

if (-not $probe_ok -and $probe.err -and ($probe.err -match "REMOTE HOST IDENTIFICATION HAS CHANGED" -or $probe.err -match "Host key verification failed")) {
    Write-Host "  WARNING: the server's SSH host key has changed (reinstall?)." -ForegroundColor Yellow
    Write-Host "  A stale fingerprint is stored in ~/.ssh/known_hosts for '$target_host'." -ForegroundColor Yellow
    $fix = AskYesNo "  Remove the stale key now and retry the probe?" $true
    if ($fix) {
        & ssh-keygen.exe -R $target_host 1>$null 2>$null
        $probe = Invoke-SSHProbe
        $probe_ok = ($probe.rc -eq 0)
    } else {
        Fail "Aborted due to host key mismatch.  Run: ssh-keygen -R $target_host"
    }
}

if ($probe_ok) {
    Write-Host "  [OK] SSH already works with your default identities -- no extra auth needed." -ForegroundColor Green
} else {
    Write-Host "  SSH is not usable yet with default identities.  Let's configure it." -ForegroundColor Yellow
    $auth_method = Ask "SSH auth method [key/password]" "key"

    if ($auth_method -eq "password") {
        $ssh_password = Ask "SSH password" -secret -required
    } else {
        $default_key = Join-Path $env:USERPROFILE ".ssh\id_ed25519"
        if (-not (Test-Path $default_key)) {
            $default_key = Join-Path $env:USERPROFILE ".ssh\id_rsa"
        }
        $ssh_key_path = Ask "SSH private key file" $default_key -required
        if (-not (Test-Path $ssh_key_path)) {
            Fail "SSH key file not found: $ssh_key_path"
        }
    }
}

Write-Host ""
Write-Host "-- Domain + SSL --" -ForegroundColor Cyan
$domain    = Ask "Public domain where the panel will answer (e.g. panel.example.com)" -required
$ssl_email = Ask "Admin email for Let's Encrypt notifications" -required

Write-Host ""
Write-Host "-- MariaDB --" -ForegroundColor Cyan
$db_install = AskYesNo "Install MariaDB on the target server too?" $true
$db_host = "localhost"
$db_port = 3306
$db_name = Ask "Panel database name" "arkmaniagest"
$db_user = Ask "Panel database user" "arkmania"
$db_pass = Ask "Panel database password (leave empty to auto-generate)" -secret
if (-not $db_pass) {
    $db_pass = New-RandomSecret 16
    Write-Host "  Auto-generated panel DB password (saved in .env): $db_pass" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "-- Admin user --" -ForegroundColor Cyan
$admin_user    = Ask "Admin username (web UI)" "admin"
$admin_display = Ask "Admin display name" "Administrator"
$admin_pass    = Ask "Admin password (min 6 chars)" -secret -required

Write-Host ""
Write-Host "-- Confirm --" -ForegroundColor Cyan
$at = [char]0x40
$target_line = '  Target     : ' + $ssh_user + $at + $target_host + ':' + $ssh_port
Write-Host $target_line
Write-Host "  Domain     : $domain"
Write-Host "  SSL email  : $ssl_email"
if ($db_install) {
    Write-Host "  MariaDB    : will be installed on target"
} else {
    Write-Host "  MariaDB    : assumed already running"
}
$dbu_line = '  DB user    : ' + $db_user + ' ' + $at + ' ' + $db_host + ':' + $db_port
Write-Host $dbu_line
Write-Host "  Admin user : $admin_user ($admin_display)"
Write-Host ""
if (-not (AskYesNo "Proceed?" $true)) {
    Fail "Aborted by user."
}

# ---------------------------------------------------------------------------
# 2. Test SSH connectivity
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "-- Testing SSH --" -ForegroundColor Cyan
$ssh_common_args = @(
    "-p", $ssh_port,
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=10"
)
if ($ssh_key_path) {
    $ssh_common_args += "-i"
    $ssh_common_args += $ssh_key_path
}

function Invoke-SSH([string[]]$remote_cmd) {
    # IMPORTANT: route stdout through Out-Host so the function's pipeline
    # does NOT mix command output with the integer exit code.  We do
    # *not* redirect stderr with `2>&1` here -- with the script's global
    # `$ErrorActionPreference = "Stop"`, every stderr line from the
    # remote command would become a terminating PowerShell error, which
    # blows up on benign messages like "Processing triggers for
    # mariadb-server".  Stderr from ssh.exe goes straight to the console
    # instead, where the user sees it in real time.
    $ssh_args = $ssh_common_args + @("${ssh_user}@${target_host}") + $remote_cmd
    & ssh.exe @ssh_args | Out-Host
    return $LASTEXITCODE
}

function Invoke-SSH-Quiet([string[]]$remote_cmd) {
    # Like Invoke-SSH but discards stdout (used for connectivity probes).
    # Stderr is suppressed too since we do not care about probe chatter.
    $ssh_args = $ssh_common_args + @("${ssh_user}@${target_host}") + $remote_cmd
    $prev_pref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & ssh.exe @ssh_args 2>&1 | Out-Null
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev_pref
    }
}

$test_rc = Invoke-SSH-Quiet @("echo", "ArkManiaGest-SSH-OK")
if ($test_rc -ne 0) {
    Fail "SSH test failed (exit $test_rc).  Verify host, port, user, key/password and that sshd is listening."
}
Write-Host "  [OK] SSH reachable" -ForegroundColor Green

# sudo check
$sudo_rc = Invoke-SSH-Quiet @("sudo", "-n", "true")
if ($sudo_rc -ne 0) {
    Write-Host "  WARNING: the user '$ssh_user' cannot run sudo without a password." -ForegroundColor Yellow
    Write-Host "           The remote install step may prompt for a password interactively." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 3. Generate local deploy.conf + .env
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "-- Generating server configuration --" -ForegroundColor Cyan

$staging = Join-Path $env:TEMP "arkmaniagest-panel-install"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

$jwt   = New-RandomSecret 32
$fek   = New-RandomSecret 32
$cron  = "cron_" + (New-RandomSecret 12)
$pubk  = "pub_"  + (New-RandomSecret 12)

# deploy.conf -- sourced by full-deploy.sh on the server
$deploy_conf = @"
DEPLOY_SERVER="${ssh_user}@${target_host}"
DOMAIN="${domain}"
SSL_EMAIL="${ssl_email}"
APP_DIR="/opt/arkmaniagest"
APP_USER="arkmania"
LOG_DIR="/var/log/arkmaniagest"
BACKUP_DIR="/opt/arkmaniagest-backups"
GEOIP_ALLOWED_COUNTRIES="IT CH"
GEOIP_WHITELIST_IPS=""
PUBLIC_SITE_ORIGIN=""
CRON_SYNC_SECRET=""
"@

# .env -- consumed by the FastAPI backend
$dotenv = @"
API_HOST=127.0.0.1
API_PORT=8000
DEBUG=false
CORS_ORIGINS=["https://${domain}"]
ALLOWED_IPS=
SSH_TIMEOUT=30

DB_HOST=${db_host}
DB_PORT=${db_port}
DB_NAME=${db_name}
DB_USER=${db_user}
DB_PASSWORD=${db_pass}

PLUGIN_DB_HOST=
PLUGIN_DB_PORT=
PLUGIN_DB_NAME=
PLUGIN_DB_USER=
PLUGIN_DB_PASSWORD=

JWT_SECRET=${jwt}
FIELD_ENCRYPTION_KEY=${fek}

PUBLIC_API_KEY=${pubk}
CRON_SECRET=${cron}
PUBLIC_ALLOWED_ORIGINS=https://${domain}
PUBLIC_SERVER_IPS=

GITHUB_REPO=Mrtritolo/ArkManiaGest
GITHUB_TOKEN=
"@

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $staging "deploy.conf"), ($deploy_conf -replace "`r`n","`n"), $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $staging ".env"),          ($dotenv      -replace "`r`n","`n"), $utf8NoBom)

Write-Host "  [OK] deploy.conf + .env prepared at $staging" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 4. Build tarball
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "-- Packaging the release tree --" -ForegroundColor Cyan

$archive = Join-Path $env:TEMP "arkmaniagest-panel-install.tar.gz"
if (Test-Path $archive) { Remove-Item -Force $archive }

$deployignore = Join-Path $PROJECT "deploy\.deployignore"
Push-Location $PROJECT
try {
    if (Test-Path $deployignore) {
        & tar.exe -czf $archive --exclude-from="$deployignore" .
    } else {
        & tar.exe -czf $archive `
            --exclude='.git' --exclude='node_modules' --exclude='venv' --exclude='.venv' `
            --exclude='__pycache__' --exclude='reference' --exclude='release-build' `
            --exclude='frontend/dist' --exclude='data/' --exclude='*.vault' --exclude='.env' `
            .
    }
    if ($LASTEXITCODE -ne 0) { Fail "tar failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}
$sizeMB = [math]::Round((Get-Item $archive).Length / 1MB, 2)
Write-Host "  [OK] archive: $archive ($sizeMB MB)" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 5. Upload + run
# ---------------------------------------------------------------------------

if ($DryRun) {
    Write-Host ""
    Write-Host "  DRY-RUN: stopping before upload.  Staging directory: $staging" -ForegroundColor Magenta
    exit 0
}

Write-Host ""
Write-Host "-- Uploading to target --" -ForegroundColor Cyan

$scp_common = @(
    "-P", $ssh_port,
    "-o", "StrictHostKeyChecking=accept-new"
)
if ($ssh_key_path) { $scp_common += @("-i", $ssh_key_path) }

function Invoke-SCP([string]$src, [string]$dst) {
    # Same exit-code-only discipline as Invoke-SSH (no `2>&1` merge to
    # avoid the ErrorActionPreference="Stop" terminating on stderr).
    $remote = "${ssh_user}@${target_host}:${dst}"
    & scp.exe @scp_common $src $remote | Out-Host
    return $LASTEXITCODE
}

if ((Invoke-SCP $archive "/tmp/arkmaniagest-deploy.tar.gz") -ne 0) {
    Fail "scp of tarball failed"
}
Write-Host "  [OK] tarball uploaded"

Invoke-SSH @("rm", "-rf", "/tmp/arkmaniagest-deploy") | Out-Null
Invoke-SSH @("mkdir", "-p", "/tmp/arkmaniagest-deploy") | Out-Null
$rc = Invoke-SSH @("tar", "-xzf", "/tmp/arkmaniagest-deploy.tar.gz", "-C", "/tmp/arkmaniagest-deploy")
if ($rc -ne 0) { Fail "remote tar extraction failed (exit $rc)" }

# Upload the generated deploy.conf + .env so full-deploy.sh picks them up.
if ((Invoke-SCP (Join-Path $staging "deploy.conf") "/tmp/arkmaniagest-deploy/deploy/deploy.conf") -ne 0) {
    Fail "scp of deploy.conf failed"
}
Invoke-SSH @("mkdir", "-p", "/tmp/arkmaniagest-deploy/backend") | Out-Null
if ((Invoke-SCP (Join-Path $staging ".env") "/tmp/arkmaniagest-deploy/backend/.env") -ne 0) {
    Fail "scp of .env failed"
}
Write-Host "  [OK] config files uploaded"

# Strip possible CRLF line endings in shell scripts (tar on Windows may have injected them).
Invoke-SSH @("find", "/tmp/arkmaniagest-deploy/deploy", "-name", "'*.sh'", "-exec", "sed", "-i", "'s/\r//g'", "{}", "+") | Out-Null

# ---------------------------------------------------------------------------
# 6. Optional: install MariaDB
# ---------------------------------------------------------------------------

function Send-RemoteScript([string]$script, [string]$remote_path) {
    # Write the script locally (LF line endings, UTF-8 no BOM), SCP it,
    # then let the caller run it via a single-arg SSH invocation.  This
    # avoids every flavour of shell-quoting headache that showed up on
    # Windows PowerShell when the script is large and contains mixed
    # quotes.
    $local_tmp = [IO.Path]::GetTempFileName()
    # Rename with .sh extension for clarity (not strictly required).
    $local_sh  = $local_tmp + ".sh"
    Rename-Item -Path $local_tmp -NewName (Split-Path $local_sh -Leaf)
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    $body = ($script -replace "`r`n", "`n")
    [System.IO.File]::WriteAllText($local_sh, $body, $utf8NoBom)
    $scp_rc = Invoke-SCP $local_sh $remote_path
    Remove-Item -Force $local_sh -ErrorAction SilentlyContinue
    return $scp_rc
}

if ($db_install) {
    Write-Host ""
    Write-Host "-- Installing MariaDB on the target --" -ForegroundColor Cyan

    # The install script body uses BASH positional args ($1/$2/$3) — we pass
    # db_name/user/pass when invoking it on the remote.  Using a *literal*
    # (single-quoted) PowerShell here-string means PS does no variable
    # expansion and no backtick escape gymnastics: what we send is exactly
    # what bash sees.
    $sql = @'
#!/usr/bin/env bash
set -euo pipefail

DB_NAME="$1"
DB_USER="$2"
DB_PASS="$3"

if [ -z "$DB_NAME" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASS" ]; then
    echo "ERROR: MariaDB install script requires 3 args: db_name db_user db_pass" >&2
    exit 2
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq mariadb-server
systemctl enable --now mariadb

# Backticks around the identifier are emitted as literal backticks because
# they are inside a bash double-quoted string where `\`` is a literal `.
mysql --user=root --execute="
  CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
  GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
  FLUSH PRIVILEGES;
"
'@

    $remote_script_path = "/tmp/arkmaniagest-install-mariadb.sh"
    $scp_rc = Send-RemoteScript $sql $remote_script_path
    if ($scp_rc -ne 0) {
        Fail "scp of MariaDB install script failed (rc=$scp_rc)"
    }
    # Shell-escape the three arguments once (single quotes + replace any ' with '\'').
    $sq_name = "'" + ($db_name -replace "'", "'\\''") + "'"
    $sq_user = "'" + ($db_user -replace "'", "'\\''") + "'"
    $sq_pass = "'" + ($db_pass -replace "'", "'\\''") + "'"
    $rc = Invoke-SSH @("sudo -n bash $remote_script_path $sq_name $sq_user $sq_pass && rm -f $remote_script_path")
    if ($rc -ne 0) {
        Write-Host "  WARNING: MariaDB install returned non-zero ($rc)." -ForegroundColor Yellow
        Write-Host "           You may need to install and grant privileges manually before re-running." -ForegroundColor Yellow
    } else {
        Write-Host "  [OK] MariaDB installed and panel DB created" -ForegroundColor Green
    }
}

# ---------------------------------------------------------------------------
# 7. Fire full-deploy.sh
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "-- Running remote bootstrap (this takes a few minutes) --" -ForegroundColor Cyan
Write-Host "  Tailing remote log. You can Ctrl+C to detach: the deploy continues on the server." -ForegroundColor DarkGray
Write-Host ""

# Single-arg form: ssh sends the string verbatim to the remote shell, so
# there is no splatting that would break across `&&`.  We swallow the
# overall non-zero exit code on purpose -- full-deploy.sh reports a
# non-zero status when its final "Backend" health check fails, but
# that's expected because we still have to overwrite the template .env
# with the real one (next step) before the backend can start.
$bootstrap = "sudo -n chmod +x /tmp/arkmaniagest-deploy/deploy/full-deploy.sh && sudo -n bash /tmp/arkmaniagest-deploy/deploy/full-deploy.sh"
$rc = Invoke-SSH @($bootstrap)
if ($rc -ne 0) {
    Write-Host "  WARNING: full-deploy.sh exited with code $rc.  This is expected for" -ForegroundColor Yellow
    Write-Host "           fresh installs because the generated .env is pushed in the" -ForegroundColor Yellow
    Write-Host "           next step; if the issue persists after that, inspect" -ForegroundColor Yellow
    Write-Host "           /tmp/arkmaniagest-deploy.log on the server." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 7b. Install the real .env + restart the backend
# ---------------------------------------------------------------------------
#
# full-deploy.sh's rsync explicitly excludes `.env` so it never replaces
# a production config.  On a fresh install it then copies the `.env.production`
# template into place.  We now overwrite that placeholder with the
# installer-generated .env (real DB_PASSWORD, JWT_SECRET, FIELD_ENCRYPTION_KEY),
# fix ownership, and restart the systemd unit.

Write-Host ""
Write-Host "-- Installing the real backend/.env and restarting the service --" -ForegroundColor Cyan

# Stage the .env under /tmp first (scp can't write /opt/... as a non-root user),
# then sudo-move it into place.
$scp_rc = Invoke-SCP (Join-Path $staging ".env") "/tmp/arkmaniagest-panel.env"
if ($scp_rc -ne 0) {
    Fail "scp of backend/.env failed"
}
$install_env = "sudo -n install -o arkmania -g arkmania -m 600 /tmp/arkmaniagest-panel.env /opt/arkmaniagest/backend/.env && sudo -n rm -f /tmp/arkmaniagest-panel.env && sudo -n systemctl restart arkmaniagest"
$rc = Invoke-SSH @($install_env)
if ($rc -ne 0) {
    Fail "Could not install backend/.env or restart the service (rc=$rc).  Run: sudo systemctl status arkmaniagest on the server."
}
Write-Host "  [OK] .env installed; backend restarted" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 7c. Wait for the backend /health endpoint
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "-- Waiting for the backend to come up --" -ForegroundColor Cyan

$health_ok = $false
foreach ($attempt in 1..15) {
    $rc = Invoke-SSH-Quiet @("curl -sf -o /dev/null http://127.0.0.1:8000/health")
    if ($rc -eq 0) {
        Write-Host "  [OK] backend /health responded after $attempt attempt(s)" -ForegroundColor Green
        $health_ok = $true
        break
    }
    Write-Host "  ... waiting (attempt $attempt / 15)" -ForegroundColor DarkGray
    Start-Sleep -Seconds 3
}
if (-not $health_ok) {
    Write-Host "  WARNING: backend did not answer on :8000.  Dumping systemd status + logs:" -ForegroundColor Yellow
    Invoke-SSH @("sudo -n systemctl --no-pager status arkmaniagest | tail -n 40") | Out-Null
    Invoke-SSH @("sudo -n journalctl -u arkmaniagest --no-pager -n 60") | Out-Null
    Fail "Backend is not answering on :8000; cannot seed admin user."
}

# ---------------------------------------------------------------------------
# 8. Seed the initial admin user
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "-- Creating the initial admin user --" -ForegroundColor Cyan

$escaped_admin_user = $admin_user.Replace("'", "'\\''")
$escaped_admin_pass = $admin_pass.Replace("'", "'\\''")
$escaped_admin_disp = $admin_display.Replace("'", "'\\''")
$admin_body = @"
{
  `"admin_username`": `"$escaped_admin_user`",
  `"admin_password`": `"$escaped_admin_pass`",
  `"admin_display_name`": `"$escaped_admin_disp`",
  `"app_name`": `"ArkManiaGest`"
}
"@
$payload_b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($admin_body))
$setup_cmd = "echo $payload_b64 | base64 -d | curl -sS -o /tmp/arkmaniagest-setup.out -w '%{http_code}' -X POST --data-binary @- -H 'Content-Type: application/json' http://127.0.0.1:8000/api/v1/settings/setup; echo; cat /tmp/arkmaniagest-setup.out; rm -f /tmp/arkmaniagest-setup.out"

$setup_rc = Invoke-SSH @($setup_cmd)
if ($setup_rc -ne 0) {
    Write-Host "  WARNING: setup endpoint returned non-zero.  You may need to open" -ForegroundColor Yellow
    Write-Host "           https://$domain and complete the setup wizard manually." -ForegroundColor Yellow
} else {
    Write-Host "  [OK] admin user created" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 9. Done
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "=================================================" -ForegroundColor Green
Write-Host "  Panel installed." -ForegroundColor Green
Write-Host "  URL       : https://$domain" -ForegroundColor Green
Write-Host "  Admin user: $admin_user" -ForegroundColor Green
Write-Host ""
Write-Host "  Local staging kept at $staging (contains deploy.conf + .env)." -ForegroundColor DarkGray
Write-Host "  Remote tarball at /tmp/arkmaniagest-deploy.tar.gz (safe to delete)." -ForegroundColor DarkGray
Write-Host "=================================================" -ForegroundColor Green
Write-Host ""
