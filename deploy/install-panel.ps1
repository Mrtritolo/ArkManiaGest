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
        # [char]0xEC, not a literal: PS 5.1 reads this BOM-less file as ANSI,
        # so a literal accented "si" would never match what the user types.
        if ($ans -in @('y','yes','s','si',"s$([char]0xEC)")) { return $true }
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
        # ssh.exe / scp.exe cannot be handed a password by a script: they
        # prompt on the console themselves, once per connection.
        Write-Host "  ssh/scp will ask for the password at every connection below (a dozen times or more)." -ForegroundColor Yellow
        Write-Host "  A key avoids that: ssh-keygen, then add the .pub to ~/.ssh/authorized_keys on the server." -ForegroundColor Yellow
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
# These three reach a remote shell command line, a SQL statement, .env and the
# SQLAlchemy URL, and none of those steps escapes them: a quote, @ or # would
# leave MariaDB and the backend with different credentials.  Keep them to
# characters that are literal everywhere.
$db_name = Ask "Panel database name" "arkmaniagest"
$db_user = Ask "Panel database user" "arkmania"
if ($db_name -notmatch '^[A-Za-z0-9_]+$' -or $db_user -notmatch '^[A-Za-z0-9_]+$') {
    Fail "Database name and user may only contain letters, digits and underscores."
}
while ($true) {
    $db_pass = Ask "Panel database password (letters, digits, _ . ~ -; leave empty to auto-generate)" -secret
    if ($db_pass -match '^[A-Za-z0-9_.~-]*$') { break }
    Write-Host "  Only letters, digits and _ . ~ - are allowed here." -ForegroundColor Yellow
}
if (-not $db_pass) {
    $db_pass = New-RandomSecret 16
    Write-Host "  Auto-generated panel DB password (saved in .env): $db_pass" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "-- Admin user --" -ForegroundColor Cyan
$admin_user    = Ask "Admin username (web UI)" "admin"
$admin_display = Ask "Admin display name" "Administrator"
# Validate here, like the DB password above.  The backend enforces the same
# rule (schemas/settings.py admin_password min_length=12 +
# validate_password_strength in schemas/auth.py, which also caps bcrypt's
# 72-byte input), but only at the very last step of the install: a weak
# value used to run apt, MariaDB, certbot, nginx and the frontend build to
# completion and then fail the setup call with a 422.
while ($true) {
    $admin_pass = Ask "Admin password (min 12 chars, at least one letter and one digit)" -secret -required
    if ($admin_pass -match '^(?=.*[A-Za-z])(?=.*\d).{12,}$' -and
        [System.Text.Encoding]::UTF8.GetByteCount($admin_pass) -le 72) { break }
    Write-Host "  At least 12 characters (max 72 bytes), with at least one letter and one digit." -ForegroundColor Yellow
}

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

# Step 7b replaces backend/.env with freshly generated JWT_SECRET and
# FIELD_ENCRYPTION_KEY.  On a panel that is already running, that makes
# every encrypted credential in its database undecryptable.
if ((Invoke-SSH-Quiet @("test", "-f", "/opt/arkmaniagest/backend/.env")) -eq 0) {
    Write-Host "  WARNING: a panel is already installed on this server (/opt/arkmaniagest/backend/.env exists)." -ForegroundColor Yellow
    Write-Host "           Reinstalling generates a new FIELD_ENCRYPTION_KEY: every encrypted credential already stored becomes unreadable." -ForegroundColor Yellow
    Write-Host "           To upgrade an existing panel use deploy\update-panel.ps1 instead." -ForegroundColor Yellow
    if (-not (AskYesNo "Reinstall anyway?" $false)) {
        Fail "Aborted: existing install left untouched."
    }
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
# The generated .env is NOT uploaded here: full-deploy.sh's rsync excludes
# .env, so a copy in this world-readable /tmp tree would never be used and
# would sit on the server with the DB password and encryption keys.  Step 7b
# installs it straight into place.
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

    # The install script reads db_name, db_user and db_pass one per line
    # from stdin, as install-panel.sh does.  As arguments (to sudo, and to
    # mysql --execute) the password showed up in ps and in sudo's command
    # log.  Using a *literal* (single-quoted) PowerShell here-string means
    # PS does no variable expansion and no backtick escape gymnastics: what
    # we send is exactly what bash sees.
    $sql = @'
#!/usr/bin/env bash
set -euo pipefail

# Windows PowerShell ends every line it pipes to ssh.exe with CRLF, and
# with a UTF-8 console or $OutputEncoding it prefixes one or two UTF-8 BOMs.
# A valid value never contains a BOM, so everything up to the last one goes.
IFS= read -r DB_NAME || true; DB_NAME=${DB_NAME##*$'\357\273\277'}; DB_NAME=${DB_NAME%$'\r'}
IFS= read -r DB_USER || true; DB_USER=${DB_USER%$'\r'}
IFS= read -r DB_PASS || true; DB_PASS=${DB_PASS%$'\r'}

if [ -z "$DB_NAME" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASS" ]; then
    echo "ERROR: MariaDB install script expects db_name, db_user, db_pass on stdin" >&2
    exit 2
fi
# Same character sets the installer enforces: any other encoding surprise
# must fail here, not create a database under a different name.
case "$DB_NAME$DB_USER" in *[!A-Za-z0-9_]*) echo "ERROR: invalid db_name/db_user received on stdin" >&2; exit 2;; esac
case "$DB_PASS" in *[!A-Za-z0-9_.~-]*) echo "ERROR: invalid db_pass received on stdin" >&2; exit 2;; esac

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq mariadb-server
systemctl enable --now mariadb

# The three values were checked against [A-Za-z0-9_.~-] above, so they need
# no SQL escaping.
mysql --user=root <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL
'@

    $remote_script_path = "/tmp/arkmaniagest-install-mariadb.sh"
    $scp_rc = Send-RemoteScript $sql $remote_script_path
    if ($scp_rc -ne 0) {
        Fail "scp of MariaDB install script failed (rc=$scp_rc)"
    }
    # Same call as Invoke-SSH, with the three values piped to ssh.exe's stdin.
    $ssh_args = $ssh_common_args + @("${ssh_user}@${target_host}", "sudo -n bash $remote_script_path && rm -f $remote_script_path")
    @($db_name, $db_user, $db_pass) | & ssh.exe @ssh_args | Out-Host
    $rc = $LASTEXITCODE
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
# then sudo-move it into place.  The file scp creates is world-readable, so it
# goes into a fresh 0700 directory (plain mkdir: fails if the name is taken),
# which is removed whether or not the install succeeds -- a failed install
# used to leave the DB password and encryption keys readable in
# /tmp/arkmaniagest-panel.env, which is cleared here too (best effort: a copy
# left by another SSH user cannot be removed and must not abort the install).
$rc = Invoke-SSH @("rm -rf /tmp/arkmaniagest-panel.env; rm -rf /tmp/arkmaniagest-panel-env && mkdir -m 700 /tmp/arkmaniagest-panel-env")
if ($rc -ne 0) {
    Fail "Could not create the private staging directory /tmp/arkmaniagest-panel-env (rc=$rc)."
}
$scp_rc = Invoke-SCP (Join-Path $staging ".env") "/tmp/arkmaniagest-panel-env/.env"
if ($scp_rc -ne 0) {
    Fail "scp of backend/.env failed"
}
$install_env = "sudo -n install -o arkmania -g arkmania -m 600 /tmp/arkmaniagest-panel-env/.env /opt/arkmaniagest/backend/.env; rc=`$?; rm -rf /tmp/arkmaniagest-panel-env; [ `$rc -eq 0 ] && sudo -n systemctl restart arkmaniagest"
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
    Write-Host "  WARNING: backend did not answer on :8000.  Dumping diagnostics:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  --- systemctl status ---" -ForegroundColor DarkYellow
    Invoke-SSH @("sudo -n systemctl --no-pager status arkmaniagest | tail -n 40") | Out-Null
    Write-Host ""
    # The Python traceback goes to /var/log/arkmaniagest/backend-error.log,
    # not to journalctl, because the systemd unit redirects StandardError
    # to a file.  journalctl will only show "Main process exited" noise.
    Write-Host "  --- /var/log/arkmaniagest/backend-error.log (last 100 lines) ---" -ForegroundColor DarkYellow
    Invoke-SSH @("sudo -n tail -n 100 /var/log/arkmaniagest/backend-error.log 2>/dev/null || echo '(file missing)'") | Out-Null
    Write-Host ""
    Write-Host "  --- /var/log/arkmaniagest/backend.log (last 40 lines) ---" -ForegroundColor DarkYellow
    Invoke-SSH @("sudo -n tail -n 40 /var/log/arkmaniagest/backend.log 2>/dev/null || echo '(file missing)'") | Out-Null
    Write-Host ""
    Write-Host "  --- journalctl (last 30 lines) ---" -ForegroundColor DarkYellow
    Invoke-SSH @("sudo -n journalctl -u arkmaniagest --no-pager -n 30") | Out-Null
    Fail "Backend is not answering on :8000; cannot seed admin user."
}

# ---------------------------------------------------------------------------
# 8. Seed the initial admin user
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "-- Creating the initial admin user --" -ForegroundColor Cyan

# ConvertTo-Json does the JSON escaping.  The payload travels base64-encoded,
# so no shell escaping applies: the old '\'' rewrite corrupted any password
# with a quote, and a " or \ produced invalid JSON.
$admin_body = @{
    admin_username     = $admin_user
    admin_password     = $admin_pass
    admin_display_name = $admin_display
    app_name           = "ArkManiaGest"
} | ConvertTo-Json -Compress
$payload_b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($admin_body))
# The payload goes on ssh.exe's stdin, as install-panel.sh does: as an
# argument the admin password was readable through ps on both ends.  It stays
# base64 because PS 5.1 re-encodes what it pipes to a native command (non-ASCII
# becomes '?' under the default $OutputEncoding) and can add CRLF and one or
# two UTF-8 BOMs; `base64 -d -i` skips every byte outside the base64 alphabet.
# curl without -f exits 0 on a 4xx/5xx, so the remote command ends on the
# HTTP status: a rejected password (422) or an existing user (409) must not
# report "[OK] admin user created".  No double quotes: PS 5.1 does not
# escape them when passing an argument to ssh.exe.
$setup_cmd = "code=`$(base64 -d -i | curl -sS -o /tmp/arkmaniagest-setup.out -w '%{http_code}' -X POST --data-binary @- -H 'Content-Type: application/json' http://127.0.0.1:8000/api/v1/settings/setup); echo HTTP `$code; cat /tmp/arkmaniagest-setup.out; echo; rm -f /tmp/arkmaniagest-setup.out; case `$code in 2??) true ;; *) false ;; esac"

$ssh_args = $ssh_common_args + @("${ssh_user}@${target_host}", $setup_cmd)
$payload_b64 | & ssh.exe @ssh_args | Out-Host
$setup_rc = $LASTEXITCODE
if ($setup_rc -ne 0) {
    Write-Host "  WARNING: the setup endpoint rejected the request (see the response above).  Open" -ForegroundColor Yellow
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
