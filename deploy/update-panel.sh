#!/usr/bin/env bash
# =============================================================================
# ArkManiaGest -- Interactive dev-side update (Linux/macOS mirror)
# =============================================================================
# Like install-panel.sh, but for a panel that is ALREADY installed.  Pushes
# the working-tree code (no GitHub release needed) to a remote panel host and
# runs server-update.sh to apply it in place.
#
# Usage:
#   ./deploy/update-panel.sh                   # fully interactive
#   ./deploy/update-panel.sh --server user@host
#   ./deploy/update-panel.sh --backend-only
#   ./deploy/update-panel.sh --frontend-only
#   ./deploy/update-panel.sh --no-deps         # skip pip / npm install
#   ./deploy/update-panel.sh --dry-run
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Paths + colours
# ---------------------------------------------------------------------------

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE="/tmp/arkmaniagest-update-$$.tar.gz"
DEPLOYIGNORE="$PROJECT/deploy/.deployignore"

C_CY='\033[36m'; C_GR='\033[32m'; C_YE='\033[33m'; C_RE='\033[31m'; C_RS='\033[0m'; C_GY='\033[90m'
section() { printf "\n${C_CY}-- %s %s${C_RS}\n" "$1" "$(printf '%.0s-' $(seq 1 $((70 - ${#1}))))"; }
ok()      { printf "  ${C_GR}[OK]${C_RS} %s\n" "$1"; }
info()    { printf "  ${C_GY}%s${C_RS}\n" "$1"; }
warn()    { printf "  ${C_YE}WARNING:${C_RS} %s\n" "$1"; }
fail()    { printf "  ${C_RE}[FAIL]${C_RS} %s\n" "$1"; exit 1; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

SERVER=""
SSH_USER=""
SSH_PORT=0
MODE="FULL"
DEPS="AUTO"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --server)        SERVER="$2"; shift 2;;
        --user)          SSH_USER="$2"; shift 2;;
        --port)          SSH_PORT="$2"; shift 2;;
        --backend-only)  MODE="BACKEND"; shift;;
        --frontend-only) MODE="FRONTEND"; shift;;
        --no-deps)       DEPS="SKIP"; shift;;
        --with-deps)     DEPS="FORCE"; shift;;
        --dry-run)       DRY_RUN=1; shift;;
        -h|--help)
            sed -n '2,20p' "$0"; exit 0;;
        *) fail "Unknown flag: $1";;
    esac
done

# ---------------------------------------------------------------------------
# Defaults from deploy/deploy.conf (if present)
# ---------------------------------------------------------------------------

CONF_FILE="$PROJECT/deploy/deploy.conf"
DEFAULT_SERVER=""; DEFAULT_USER="root"; DEFAULT_PORT=22
if [[ -f "$CONF_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$CONF_FILE" || true
    DEFAULT_SERVER="${DEPLOY_SERVER:-$DEFAULT_SERVER}"
    DEFAULT_USER="${SSH_USER_CONF:-${SSH_USER:-$DEFAULT_USER}}"
    DEFAULT_PORT="${SSH_PORT_CONF:-${SSH_PORT:-$DEFAULT_PORT}}"
fi

section "ArkManiaGest -- Dev update"
info "Project: $PROJECT"

# ---------------------------------------------------------------------------
# 1. Prompts
# ---------------------------------------------------------------------------

section "Target panel host"

if [[ -z "$SERVER" ]]; then
    if [[ -n "$DEFAULT_SERVER" ]]; then
        read -r -p "Server address (IP or hostname) [$DEFAULT_SERVER]: " SERVER
        SERVER="${SERVER:-$DEFAULT_SERVER}"
    else
        read -r -p "Server address (IP or hostname): " SERVER
    fi
fi
[[ -z "$SERVER" ]] && fail "Server address is required."

# Accept user@host too.
if [[ "$SERVER" == *"@"* ]]; then
    SSH_USER="${SSH_USER:-${SERVER%@*}}"
    SERVER="${SERVER#*@}"
fi
[[ -z "$SSH_USER" ]]       && { read -r -p "SSH user [$DEFAULT_USER]: "  SSH_USER;  SSH_USER="${SSH_USER:-$DEFAULT_USER}"; }
[[ "$SSH_PORT" -le 0 ]]    && { read -r -p "SSH port [$DEFAULT_PORT]: "  SSH_PORT;  SSH_PORT="${SSH_PORT:-$DEFAULT_PORT}"; }

SSH_TARGET="${SSH_USER}@${SERVER}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o ServerAliveInterval=30 -p "$SSH_PORT")

run_ssh()       { ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"; }
run_ssh_quiet() { ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# 2. SSH probe
# ---------------------------------------------------------------------------

section "Probing SSH (default keys / agent)"
if ! run_ssh_quiet "echo ArkManiaGest-DevUpdate-OK"; then
    fail "SSH to $SSH_TARGET failed.  Fix keys / agent first, then rerun."
fi
ok "SSH OK"

# ---------------------------------------------------------------------------
# 3. Sanity checks on the remote host
# ---------------------------------------------------------------------------

section "Sanity checks"

if ! run_ssh_quiet "test -f /opt/arkmaniagest/backend/.env"; then
    warn "/opt/arkmaniagest/backend/.env not found on target."
    warn "This script updates an EXISTING panel.  For a fresh install, use install-panel.sh."
    read -r -p "Continue anyway? [y/N]: " GO
    [[ "${GO:-N}" =~ ^[yY]$ ]] || exit 1
fi

if ! run_ssh_quiet "test -f /opt/arkmaniagest/deploy/server-update.sh"; then
    warn "server-update.sh not present on target; uploading a fresh copy alongside."
fi
ok "Checks done"

# ---------------------------------------------------------------------------
# 4. Package working tree
# ---------------------------------------------------------------------------

section "Packaging working tree"
if [[ "$DRY_RUN" = "1" ]]; then
    info "Dry run: would tar the project and skip upload/run."
    exit 0
fi

cd "$PROJECT"
if [[ -f "$DEPLOYIGNORE" ]]; then
    tar -czf "$ARCHIVE" --exclude-from="$DEPLOYIGNORE" .
else
    warn ".deployignore not found; using inline exclusion list"
    tar -czf "$ARCHIVE" \
        --exclude=node_modules --exclude=venv --exclude=__pycache__ \
        --exclude=.git --exclude=frontend/dist \
        --exclude='*.vault' --exclude='.env' \
        --exclude='deploy/maintainer' --exclude='release-build' \
        .
fi
SIZE_MB=$(du -m "$ARCHIVE" | cut -f1)
ok "Archive: $ARCHIVE (${SIZE_MB} MB)"

# ---------------------------------------------------------------------------
# 5. Upload + run server-update.sh
# ---------------------------------------------------------------------------

section "Uploading to target"

scp -o StrictHostKeyChecking=accept-new -P "$SSH_PORT" "$ARCHIVE" \
    "${SSH_TARGET}:/tmp/arkmaniagest-update.tar.gz"
ok "Tarball uploaded"

LOCAL_SCRIPT="$PROJECT/deploy/server-update.sh"
if [[ -f "$LOCAL_SCRIPT" ]]; then
    scp -o StrictHostKeyChecking=accept-new -P "$SSH_PORT" "$LOCAL_SCRIPT" \
        "${SSH_TARGET}:/tmp/server-update.sh"
    ok "Update script uploaded"
fi

section "Running remote update"

REMOTE_CMD=$(cat <<EOF
set -e
chmod +x /tmp/server-update.sh
if command -v sudo >/dev/null 2>&1 && [ "\$(id -un)" != "root" ]; then
    sudo -n bash /tmp/server-update.sh $MODE $DEPS
else
    bash /tmp/server-update.sh $MODE $DEPS
fi
rm -f /tmp/server-update.sh
EOF
)
run_ssh "$REMOTE_CMD"
ok "Remote update finished"

# ---------------------------------------------------------------------------
# 6. Verify
# ---------------------------------------------------------------------------

section "Verification"
if run_ssh_quiet "curl -sf http://127.0.0.1:8000/health >/dev/null"; then
    ok "Backend /health responded"
    run_ssh "curl -sf http://127.0.0.1:8000/health" || true
else
    warn "Backend not answering /health yet.  Check: sudo systemctl status arkmaniagest"
fi

rm -f "$ARCHIVE"
section "Done"
