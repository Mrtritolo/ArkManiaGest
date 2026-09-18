#!/usr/bin/env bash
# =============================================================================
# ArkManiaGest - Interactive panel installer (Linux client)
# =============================================================================
# Installs the ArkManiaGest admin panel on a remote Linux server that has
# only OpenSSH listening (nothing else preinstalled).  Run this from your
# Linux dev PC (bash):
#
#     bash ./deploy/install-panel.sh
#
# The script prompts for every piece of information it needs (SSH target,
# admin email, domain, MariaDB password, etc.), writes deploy/deploy.conf
# and backend/.env on the fly, tar-bundles the release tree, uploads it
# to /tmp on the remote server, and launches deploy/full-deploy.sh there.
#
# Requirements on the CLIENT:
#   - bash, ssh, scp, tar, openssl, curl   (all standard on any Linux)
#   - A release checkout of ArkManiaGest (deploy/, backend/, frontend/)
#
# Requirements on the TARGET SERVER:
#   - Reachable via SSH with a sudo-capable account
#   - Debian 11+ / Ubuntu 22.04+ (what full-deploy.sh expects)
#   - Internet access
#
# Targeting a Windows server is not supported by this script: install WSL2
# + Ubuntu on the Windows host and treat it as a Linux target (see the
# "Panel on Windows via WSL2" section in README.md).
# =============================================================================

set -u -o pipefail

DRY_RUN=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        -h|--help)
            head -n 32 "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
    shift
done

# ---------------------------------------------------------------------------
# Colours (no-op when stdout is not a tty)
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
    C_CY=$'\e[36m'; C_YL=$'\e[33m'; C_GN=$'\e[32m'; C_RD=$'\e[31m'
    C_GR=$'\e[90m'; C_MG=$'\e[35m'; C_RS=$'\e[0m'
else
    C_CY=""; C_YL=""; C_GN=""; C_RD=""; C_GR=""; C_MG=""; C_RS=""
fi

section() { echo ""; echo "${C_CY}-- $1 --${C_RS}"; }
action()  { echo "${C_YL}  > $1${C_RS}"; }
ok()      { echo "${C_GN}  [OK] $1${C_RS}"; }
warn()    { echo "${C_YL}  WARN: $1${C_RS}"; }
fail()    { echo ""; echo "${C_RD}  [ABORT] $1${C_RS}"; exit 1; }

ask() {
    # Usage: ask "Question" [default] [--secret] [--required]
    local question="$1"; shift
    local default=""
    local secret=0
    local required=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --secret)   secret=1 ;;
            --required) required=1 ;;
            *)          default="$1" ;;
        esac
        shift
    done
    while :; do
        local prompt="${question}"
        if [[ -n "$default" ]]; then prompt="${prompt} [${default}]"; fi
        prompt="${prompt}: "
        local answer=""
        # Callers capture stdout with $(ask ...), so everything but the
        # answer goes to stderr: the newline after a secret used to prefix
        # every password, and the warning ended up inside the value.
        if [[ $secret -eq 1 ]]; then
            read -r -s -p "$prompt" answer </dev/tty
            echo >&2
        else
            read -r -p "$prompt" answer </dev/tty
        fi
        if [[ -z "$answer" ]]; then answer="$default"; fi
        if [[ $required -eq 1 && -z "$answer" ]]; then
            warn "This value is required." >&2
            continue
        fi
        printf '%s' "$answer"
        return 0
    done
}

yesno() {
    # Usage: yesno "Question" [default(y|n)]
    local question="$1"
    local default="${2:-y}"
    local hint="[Y/n]"; [[ "$default" == "n" ]] && hint="[y/N]"
    while :; do
        local ans=""
        read -r -p "${question} ${hint} " ans </dev/tty
        ans="${ans,,}"
        if [[ -z "$ans" ]]; then ans="$default"; fi
        case "$ans" in
            y|yes|s|si|sì) return 0 ;;
            n|no)          return 1 ;;
        esac
    done
}

random_hex() {
    # Usage: random_hex 32   (32 bytes → 64 hex chars)
    local bytes="${1:-32}"
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex "$bytes"
    else
        head -c "$bytes" /dev/urandom | hexdump -e '/1 "%02x"'
    fi
}

json_escape() {
    # Minimal JSON string escape: backslash and double-quote only.
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# ---------------------------------------------------------------------------
# 0. Sanity
# ---------------------------------------------------------------------------

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT"

echo ""
echo "${C_CY}=================================================${C_RS}"
echo "${C_CY}  ArkManiaGest - Panel installer${C_RS}"
echo "${C_CY}  Target: remote Linux server over SSH${C_RS}"
echo "${C_CY}=================================================${C_RS}"

for tool in ssh scp tar curl; do
    command -v "$tool" >/dev/null 2>&1 || fail "Required tool '$tool' is not available on this client."
done

if [[ ! -f "deploy/full-deploy.sh" ]]; then
    fail "This script must live inside an ArkManiaGest release tree (deploy/full-deploy.sh is missing)."
fi

# ---------------------------------------------------------------------------
# 1. Prompts
# ---------------------------------------------------------------------------

section "Target server"
TARGET_HOST=$(ask "Server address (IP or hostname)" --required)
SSH_USER=$(ask "SSH user (must have sudo access)" "root")
SSH_PORT=$(ask "SSH port" "22")

SSH_KEY=""
SSH_PASSWORD=""

# Probe first: if the user already has ssh-agent and/or a default
# ~/.ssh/id_* key that works against the target, skip the auth prompts
# entirely.  BatchMode=yes disables password/interactive auth so the
# probe fails cleanly when no usable key is found.  We capture stderr
# to detect "host key changed" after a server reinstall and offer an
# auto-fix via ssh-keygen -R.
section "Probing SSH (using default keys / ssh-agent)"

ssh_probe() {
    ssh -p "$SSH_PORT" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 \
        "${SSH_USER}@${TARGET_HOST}" "echo ArkManiaGest-SSH-OK" \
        >/dev/null 2>"$1"
    return $?
}

probe_err="$(mktemp)"
probe_ok=0
if ssh_probe "$probe_err"; then
    probe_ok=1
fi

if [[ $probe_ok -eq 0 ]] && grep -qE "REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed" "$probe_err" 2>/dev/null; then
    warn "the server's SSH host key has changed (reinstall?)."
    warn "A stale fingerprint is stored in ~/.ssh/known_hosts for '${TARGET_HOST}'."
    if yesno "Remove the stale key now and retry the probe?" "y"; then
        ssh-keygen -R "$TARGET_HOST" >/dev/null 2>&1 || true
        if ssh_probe "$probe_err"; then
            probe_ok=1
        fi
    else
        rm -f "$probe_err"
        fail "Aborted due to host key mismatch.  Run: ssh-keygen -R ${TARGET_HOST}"
    fi
fi
rm -f "$probe_err"

if [[ $probe_ok -eq 1 ]]; then
    ok "SSH already works with your default identities - no extra auth needed."
else
    warn "SSH is not usable yet with default identities.  Let's configure it."
    AUTH_METHOD=$(ask "SSH auth method [key/password]" "key")
    if [[ "$AUTH_METHOD" == "password" ]]; then
        SSH_PASSWORD=$(ask "SSH password" --secret --required)
        command -v sshpass >/dev/null 2>&1 || fail "Password auth needs 'sshpass' on the client. Install it or use key auth."
    else
        default_key="${HOME}/.ssh/id_ed25519"
        [[ -f "$default_key" ]] || default_key="${HOME}/.ssh/id_rsa"
        SSH_KEY=$(ask "SSH private key file" "$default_key" --required)
        [[ -f "$SSH_KEY" ]] || fail "SSH key not found: $SSH_KEY"
    fi
fi

section "Domain + SSL"
DOMAIN=$(ask "Public domain where the panel will answer" --required)
SSL_EMAIL=$(ask "Admin email for Let's Encrypt notifications" --required)

section "MariaDB"
if yesno "Install MariaDB on the target server too?" "y"; then
    DB_INSTALL=1
else
    DB_INSTALL=0
fi
DB_HOST="localhost"
DB_PORT="3306"
DB_NAME=$(ask "Panel database name" "arkmaniagest")
DB_USER=$(ask "Panel database user" "arkmania")
DB_PASS=$(ask "Panel database password (leave empty to auto-generate)" --secret)
if [[ -z "$DB_PASS" ]]; then
    DB_PASS=$(random_hex 12)
    echo "${C_YL}  Auto-generated panel DB password (saved in .env): $DB_PASS${C_RS}"
fi

section "Admin user"
ADMIN_USER=$(ask "Admin username (web UI)" "admin")
ADMIN_DISPLAY=$(ask "Admin display name" "Administrator")
# Same rule as the setup endpoint (12+ chars, at most 72 bytes for bcrypt,
# a letter and a digit): a password it rejects only shows up after the whole
# remote deploy.
while :; do
    ADMIN_PASS=$(ask "Admin password (12+ chars, max 72 bytes, at least one letter and one digit)" --secret --required)
    if [[ ${#ADMIN_PASS} -ge 12 && $(printf '%s' "$ADMIN_PASS" | wc -c) -le 72 \
          && "$ADMIN_PASS" =~ [[:alpha:]] && "$ADMIN_PASS" =~ [[:digit:]] ]]; then
        break
    fi
    warn "Use 12 to 72 bytes (fewer characters if accented), including a letter and a digit."
done

section "Confirm"
echo "  Target     : ${SSH_USER}@${TARGET_HOST}:${SSH_PORT}"
echo "  Domain     : $DOMAIN"
echo "  SSL email  : $SSL_EMAIL"
if [[ $DB_INSTALL -eq 1 ]]; then
    echo "  MariaDB    : will be installed on target"
else
    echo "  MariaDB    : assumed already running on target"
fi
echo "  DB user    : $DB_USER @ $DB_HOST:$DB_PORT"
echo "  Admin user : $ADMIN_USER ($ADMIN_DISPLAY)"
echo ""
yesno "Proceed?" "y" || fail "Aborted by user."

# ---------------------------------------------------------------------------
# 2. SSH connectivity
# ---------------------------------------------------------------------------

SSH_COMMON=(-p "$SSH_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
SCP_COMMON=(-P "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
if [[ -n "$SSH_KEY" ]]; then
    SSH_COMMON+=(-i "$SSH_KEY")
    SCP_COMMON+=(-i "$SSH_KEY")
fi

# sshpass -e reads SSHPASS from the environment: with -p the SSH password
# sat in sshpass's argv, readable by every local user through ps.
run_ssh() {
    if [[ -n "$SSH_PASSWORD" ]]; then
        SSHPASS="$SSH_PASSWORD" sshpass -e ssh "${SSH_COMMON[@]}" "${SSH_USER}@${TARGET_HOST}" "$@"
    else
        ssh "${SSH_COMMON[@]}" "${SSH_USER}@${TARGET_HOST}" "$@"
    fi
}
run_scp() {
    local src="$1" dst="$2"
    if [[ -n "$SSH_PASSWORD" ]]; then
        SSHPASS="$SSH_PASSWORD" sshpass -e scp "${SCP_COMMON[@]}" "$src" "${SSH_USER}@${TARGET_HOST}:${dst}"
    else
        scp "${SCP_COMMON[@]}" "$src" "${SSH_USER}@${TARGET_HOST}:${dst}"
    fi
}

section "Testing SSH"
if ! run_ssh echo ArkManiaGest-SSH-OK >/dev/null 2>&1; then
    fail "SSH test failed.  Verify host, port, user, and credentials, and that sshd is listening."
fi
ok "SSH reachable"

if ! run_ssh sudo -n true >/dev/null 2>&1; then
    warn "'$SSH_USER' cannot run sudo without a password.  The remote install step may prompt interactively."
fi

# Step 7b replaces backend/.env with freshly generated JWT_SECRET and
# FIELD_ENCRYPTION_KEY.  On a panel that is already running, that makes
# every encrypted credential in its database undecryptable.
if run_ssh "test -f /opt/arkmaniagest/backend/.env" >/dev/null 2>&1; then
    warn "A panel is already installed on this server (/opt/arkmaniagest/backend/.env exists)."
    warn "Reinstalling generates a new FIELD_ENCRYPTION_KEY: every encrypted credential already stored becomes unreadable."
    warn "To upgrade an existing panel use deploy/update-panel.sh instead."
    yesno "Reinstall anyway?" "n" || fail "Aborted: existing install left untouched."
fi

# ---------------------------------------------------------------------------
# 3. Generate deploy.conf + .env
# ---------------------------------------------------------------------------

section "Generating server configuration"

STAGING="$(mktemp -d -t arkmaniagest-panel-install-XXXX)"
trap 'rm -rf "$STAGING"' EXIT

JWT="$(random_hex 32)"
FEK="$(random_hex 32)"
CRON="cron_$(random_hex 6)"
PUBK="pub_$(random_hex 6)"

cat > "${STAGING}/deploy.conf" <<EOF
DEPLOY_SERVER="${SSH_USER}@${TARGET_HOST}"
DOMAIN="${DOMAIN}"
SSL_EMAIL="${SSL_EMAIL}"
APP_DIR="/opt/arkmaniagest"
APP_USER="arkmania"
LOG_DIR="/var/log/arkmaniagest"
BACKUP_DIR="/opt/arkmaniagest-backups"
GEOIP_ALLOWED_COUNTRIES="IT CH"
GEOIP_WHITELIST_IPS=""
PUBLIC_SITE_ORIGIN=""
CRON_SYNC_SECRET=""
EOF

cat > "${STAGING}/.env" <<EOF
API_HOST=127.0.0.1
API_PORT=8000
DEBUG=false
CORS_ORIGINS=["https://${DOMAIN}"]
ALLOWED_IPS=
SSH_TIMEOUT=30

DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASS}

PLUGIN_DB_HOST=
PLUGIN_DB_PORT=
PLUGIN_DB_NAME=
PLUGIN_DB_USER=
PLUGIN_DB_PASSWORD=

JWT_SECRET=${JWT}
FIELD_ENCRYPTION_KEY=${FEK}

PUBLIC_API_KEY=${PUBK}
CRON_SECRET=${CRON}
PUBLIC_ALLOWED_ORIGINS=https://${DOMAIN}
PUBLIC_SERVER_IPS=

GITHUB_REPO=Mrtritolo/ArkManiaGest
GITHUB_TOKEN=
EOF

ok "deploy.conf + .env prepared at ${STAGING}"

# ---------------------------------------------------------------------------
# 4. Tarball
# ---------------------------------------------------------------------------

section "Packaging the release tree"

ARCHIVE="${STAGING}/arkmaniagest-deploy.tar.gz"
DEPLOYIGNORE="deploy/.deployignore"
# A failing tar still leaves an archive, minus the files it could not read,
# and full-deploy.sh syncs it with rsync --delete: stop here instead.
if [[ -f "$DEPLOYIGNORE" ]]; then
    tar -czf "$ARCHIVE" --exclude-from="$DEPLOYIGNORE" . || fail "tar failed"
else
    tar -czf "$ARCHIVE" \
        --exclude='.git' --exclude='node_modules' --exclude='venv' --exclude='.venv' \
        --exclude='__pycache__' --exclude='reference' --exclude='release-build' \
        --exclude='frontend/dist' --exclude='data/' --exclude='*.vault' --exclude='.env' \
        . || fail "tar failed"
fi
ok "archive: $ARCHIVE ($(du -sh "$ARCHIVE" | cut -f1))"

# ---------------------------------------------------------------------------
# 5. Upload + run
# ---------------------------------------------------------------------------

if [[ $DRY_RUN -eq 1 ]]; then
    echo ""
    echo "${C_MG}  DRY-RUN: stopping before upload.  Staging: $STAGING${C_RS}"
    trap - EXIT
    exit 0
fi

section "Uploading to target"
run_scp "$ARCHIVE" /tmp/arkmaniagest-deploy.tar.gz || fail "scp of tarball failed"
ok "tarball uploaded"

run_ssh "rm -rf /tmp/arkmaniagest-deploy && mkdir -p /tmp/arkmaniagest-deploy && tar -xzf /tmp/arkmaniagest-deploy.tar.gz -C /tmp/arkmaniagest-deploy" \
    || fail "remote tar extraction failed"

run_scp "${STAGING}/deploy.conf" /tmp/arkmaniagest-deploy/deploy/deploy.conf || fail "scp of deploy.conf failed"
# The generated .env is NOT uploaded here: full-deploy.sh's rsync excludes
# .env, so a copy in this world-readable /tmp tree was never used and sat on
# the server with the DB password and encryption keys.  Step 7b installs it
# straight into place.
ok "config files uploaded"

# Strip CRLF just in case the tar was round-tripped through Windows
run_ssh "find /tmp/arkmaniagest-deploy/deploy -name '*.sh' -exec sed -i 's/\r//g' {} +" >/dev/null

# ---------------------------------------------------------------------------
# 6. MariaDB (optional)
# ---------------------------------------------------------------------------

if [[ $DB_INSTALL -eq 1 ]]; then
    section "Installing MariaDB on the target"
    # The install script reads db_name, db_user and db_pass one per line
    # from stdin.  As arguments the password showed up in ps on both ends
    # and in sudo's command log, and inside `mysql --execute` a quote in it
    # broke the SQL.
    local_script="${STAGING}/install-mariadb.sh"
    cat > "$local_script" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

IFS= read -r DB_NAME
IFS= read -r DB_USER
IFS= read -r DB_PASS

if [ -z "$DB_NAME" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASS" ]; then
    echo "ERROR: MariaDB install script expects db_name, db_user, db_pass on stdin" >&2
    exit 2
fi

# SQL string literal: double the backslashes and the single quotes.
sql_str() { local s="${1//\\/\\\\}"; printf '%s' "${s//\'/\'\'}"; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq mariadb-server
systemctl enable --now mariadb

mysql --user=root <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$(sql_str "$DB_USER")'@'localhost' IDENTIFIED BY '$(sql_str "$DB_PASS")';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$(sql_str "$DB_USER")'@'localhost';
FLUSH PRIVILEGES;
SQL
EOF
    remote_script="/tmp/arkmaniagest-install-mariadb.sh"
    run_scp "$local_script" "$remote_script" || fail "scp of MariaDB install script failed"

    if printf '%s\n%s\n%s\n' "$DB_NAME" "$DB_USER" "$DB_PASS" \
        | run_ssh "sudo -n bash $remote_script && rm -f $remote_script"; then
        ok "MariaDB installed and panel DB created"
    else
        warn "MariaDB install returned non-zero; may need manual grants before re-running."
    fi
fi

# ---------------------------------------------------------------------------
# 7. Fire full-deploy.sh
# ---------------------------------------------------------------------------

section "Running remote bootstrap (takes a few minutes)"
echo "${C_GR}  Tailing remote log. Ctrl+C detaches; the deploy continues on the server.${C_RS}"
echo ""
# full-deploy.sh finishes with the final health check, which will fail on
# a fresh install because the real .env hasn't been installed yet (the
# rsync in full-deploy.sh explicitly excludes .env).  We deliberately do
# NOT abort on that non-zero exit; we overwrite .env and restart the
# service in the next step.
if ! run_ssh "sudo -n chmod +x /tmp/arkmaniagest-deploy/deploy/full-deploy.sh && sudo -n bash /tmp/arkmaniagest-deploy/deploy/full-deploy.sh"; then
    warn "full-deploy.sh exited non-zero; this is expected on a fresh install."
    warn "If the issue persists after the .env install step, inspect /tmp/arkmaniagest-deploy.log."
fi

# ---------------------------------------------------------------------------
# 7b. Install the real .env + restart the backend
# ---------------------------------------------------------------------------

section "Installing the real backend/.env and restarting the service"

# Streamed over ssh's stdin: an scp to /tmp left the secrets world-readable
# on the server until the install below moved them.
if ! run_ssh "sudo -n install -o arkmania -g arkmania -m 600 /dev/stdin /opt/arkmaniagest/backend/.env && sudo -n systemctl restart arkmaniagest" < "${STAGING}/.env"; then
    fail "Could not install backend/.env or restart the service. Run: sudo systemctl status arkmaniagest on the server."
fi
ok ".env installed; backend restarted"

# ---------------------------------------------------------------------------
# 7c. Wait for the backend /health endpoint
# ---------------------------------------------------------------------------

section "Waiting for the backend to come up"

health_ok=0
for attempt in $(seq 1 15); do
    if run_ssh "curl -sf -o /dev/null http://127.0.0.1:8000/health" >/dev/null 2>&1; then
        ok "backend /health responded after ${attempt} attempt(s)"
        health_ok=1
        break
    fi
    echo "${C_GR}  ... waiting (attempt ${attempt} / 15)${C_RS}"
    sleep 3
done
if [[ $health_ok -ne 1 ]]; then
    warn "backend did not answer on :8000. Dumping diagnostics:"
    echo ""
    echo "  --- systemctl status ---"
    run_ssh "sudo -n systemctl --no-pager status arkmaniagest | tail -n 40" || true
    echo ""
    # The Python traceback goes to /var/log/arkmaniagest/backend-error.log,
    # not to journalctl, because the systemd unit redirects StandardError
    # to a file.  journalctl will only show "Main process exited" noise.
    echo "  --- /var/log/arkmaniagest/backend-error.log (last 100 lines) ---"
    run_ssh "sudo -n tail -n 100 /var/log/arkmaniagest/backend-error.log 2>/dev/null || echo '(file missing)'" || true
    echo ""
    echo "  --- /var/log/arkmaniagest/backend.log (last 40 lines) ---"
    run_ssh "sudo -n tail -n 40 /var/log/arkmaniagest/backend.log 2>/dev/null || echo '(file missing)'" || true
    echo ""
    echo "  --- journalctl (last 30 lines) ---"
    run_ssh "sudo -n journalctl -u arkmaniagest --no-pager -n 30" || true
    fail "Backend not answering on :8000; cannot seed admin user."
fi

# ---------------------------------------------------------------------------
# 8. Admin user
# ---------------------------------------------------------------------------

section "Creating the initial admin user"

ADMIN_USER_JS="$(json_escape "$ADMIN_USER")"
ADMIN_PASS_JS="$(json_escape "$ADMIN_PASS")"
ADMIN_DISP_JS="$(json_escape "$ADMIN_DISPLAY")"
admin_body="{\"admin_username\":\"${ADMIN_USER_JS}\",\"admin_password\":\"${ADMIN_PASS_JS}\",\"admin_display_name\":\"${ADMIN_DISP_JS}\",\"app_name\":\"ArkManiaGest\"}"

# The body travels on ssh's stdin: as a base64 argument the admin password
# was readable through ps on both ends.  curl without -f exits 0 on a 4xx,
# so judge the HTTP status: a rejected password (422) or an existing user
# (409) must not report "admin user created" and leave the setup open.
setup_out="$(printf '%s' "$admin_body" | run_ssh "curl -sS -w '\n%{http_code}' -X POST --data-binary @- -H 'Content-Type: application/json' http://127.0.0.1:8000/api/v1/settings/setup")"
setup_code="${setup_out##*$'\n'}"
if [[ "$setup_code" == 2?? ]]; then
    ok "admin user created"
else
    if [[ "$setup_code" == 422 ]]; then
        # A 422 body echoes the rejected values ("input"), the password
        # included: print only the messages.
        printf '%s\n' "${setup_out%$'\n'*}" | grep -o '"msg":"[^"]*"' | sed 's/^/  /'
    else
        echo "  ${setup_out%$'\n'*}"
    fi
    warn "setup endpoint answered HTTP ${setup_code:-none}.  Complete the setup wizard manually at https://${DOMAIN}."
fi

# ---------------------------------------------------------------------------
# 9. Done
# ---------------------------------------------------------------------------

echo ""
echo "${C_GN}=================================================${C_RS}"
echo "${C_GN}  Panel installed.${C_RS}"
echo "${C_GN}  URL       : https://${DOMAIN}${C_RS}"
echo "${C_GN}  Admin user: ${ADMIN_USER}${C_RS}"
echo ""
echo "${C_GR}  Client staging (deploy.conf + .env) stays until this shell exits.${C_RS}"
echo "${C_GR}  Remote tarball: /tmp/arkmaniagest-deploy.tar.gz (safe to delete).${C_RS}"
echo "${C_GN}=================================================${C_RS}"
echo ""
