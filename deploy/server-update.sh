#!/usr/bin/env bash
# ============================================
# ArkManiaGest - Server-side update script
# Run locally by update-panel.{ps1,sh} OR by the in-UI self-updater
# (POST /api/v1/system-update/install).  Argomenti:
#   $1=MODE  (FULL|BACKEND|FRONTEND)
#   $2=DEPS  (AUTO|FORCE|SKIP)
# ============================================
set -e

MODE=${1:-FULL}
DEPS=${2:-AUTO}
APP=/opt/arkmaniagest
TMP=/tmp/arkmaniagest-update
USR=arkmania

# When the in-UI updater launches this script it pre-creates a status
# JSON file at $STATUS_FILE; we overwrite the `state` / `message` /
# `finished_at` keys on our way through so the browser poll can show
# success/failed even though systemd kills THIS process when we restart
# the panel at the end of the run.  (server-update.sh runs inside the
# panel's cgroup; `systemctl restart` is synchronous, so when systemd
# stops the old unit it SIGTERMs us -- anything AFTER the restart line
# never executes.)  Writing the final status BEFORE the restart is the
# simplest way to get the UI to transition cleanly.
STATUS_FILE="/tmp/arkmaniagest-update-status.json"
finalise_status() {
    local state="$1"
    local msg="$2"
    [ -f "$STATUS_FILE" ] || return 0
    python3 - "$STATUS_FILE" "$state" "$msg" <<'PYEOF' 2>/dev/null || true
import json, os, sys, datetime
path, state, msg = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(path) as f:
        d = json.load(f)
except Exception:
    d = {}
d["state"]        = state
d["message"]      = msg
d["finished_at"]  = datetime.datetime.now(datetime.timezone.utc).isoformat()
if state == "success":
    d["progress_pct"] = 100
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(d, f, indent=2)
os.replace(tmp, path)
PYEOF
}
# Any non-zero exit from this point on is reported as a failed update.
trap 'rc=$?; finalise_status failed "server-update.sh exited with code $rc"' ERR

echo ""
echo "=== ArkManiaGest Update ==="
echo "Mode: $MODE  Deps: $DEPS"
echo ""

# Extract
rm -rf $TMP
mkdir -p $TMP
tar -xzf /tmp/arkmaniagest-update.tar.gz -C $TMP
rm -f /tmp/arkmaniagest-update.tar.gz

# Tarballs come in two flavours:
#   (a) GitHub release bundle: `arkmaniagest-vX.Y.Z/` as a single top-level
#       directory, code inside it.
#   (b) dev push via update-panel.{ps1,sh}: files at the archive root.
# rsync --delete from the wrong root is catastrophic -- it would wipe
# every project dir at the destination, then drop a nested
# arkmaniagest-vX.Y.Z/ into /opt/arkmaniagest.  Detect (a) and shift
# ROOT one level deeper.
ROOT="$TMP"
TMP_ENTRIES=$(find "$TMP" -mindepth 1 -maxdepth 1 | wc -l)
if [ "$TMP_ENTRIES" = "1" ]; then
    INNER=$(find "$TMP" -mindepth 1 -maxdepth 1)
    if [ -d "$INNER" ] && [ -d "$INNER/backend" ] && [ -d "$INNER/frontend" ]; then
        echo "  Detected release-bundle layout, using $INNER as source root"
        ROOT="$INNER"
    fi
fi

# Sync file
echo "[1/4] Sync file..."
# --delete removes files on the server that no longer exist in the source,
# keeping the production directory clean from leftovers of old deploys.
# Runtime directories (venv, node_modules, dist, data) and secrets (.env)
# are protected via --exclude so they are never touched.
# arkmaniagest-v*/ is explicitly excluded to clean up the orphan directory
# that a previous botched update may have left behind.
rsync -a --delete \
    --exclude=venv \
    --exclude=node_modules \
    --exclude=__pycache__ \
    --exclude='data/' \
    --exclude='*.vault' \
    --exclude='.env' \
    --exclude='frontend/dist' \
    --exclude='_deprecated/' \
    --exclude='config/' \
    --exclude='tests/' \
    --exclude='Specifiche/' \
    --exclude='reference/' \
    "$ROOT"/ $APP/

# Clean up orphan release-bundle directory if it was dropped by a
# previous broken update run.  Check on the literal pattern, not via
# glob, so shell globbing expansion doesn't break set -e.
for ORPHAN in "$APP"/arkmaniagest-v*/; do
    [ -d "$ORPHAN" ] || continue
    echo "  Removing orphan bundle dir: $ORPHAN"
    rm -rf "$ORPHAN"
done
chown -R $USR:$USR $APP

# Strip Windows CRLF from all shell scripts synced from the Windows tar archive.
find "$APP/deploy" -name "*.sh" -exec sed -i 's/\r//g' {} \;

# Append any new keys from the template to the live .env (idempotent).
bash "$APP/deploy/migrate-env.sh" "$APP" || true
chown "$USR:$USR" "$APP/backend/.env"
chmod 600 "$APP/backend/.env"
echo "  OK"

# Backend
if [ "$MODE" != "FRONTEND" ]; then
    echo "[2/4] Backend..."
    cd $APP/backend

    if [ ! -d "venv" ]; then
        sudo -u $USR python3 -m venv venv
    fi

    if [ "$DEPS" = "FORCE" ] || [ "$DEPS" = "AUTO" -a ! -f "venv/.deps_installed" ]; then
        echo "  pip install..."
        sudo -u $USR venv/bin/pip install -q --upgrade pip
        sudo -u $USR venv/bin/pip install -q -r requirements.txt
        touch venv/.deps_installed
    else
        echo "  Deps: skip"
    fi

    # Aggiorna systemd service
    cp $APP/deploy/arkmaniagest.service /etc/systemd/system/arkmaniagest.service
    systemctl daemon-reload
    echo "  OK"
else
    echo "[2/4] Backend: skip"
fi

# Frontend
if [ "$MODE" != "BACKEND" ]; then
    echo "[3/4] Frontend..."
    cd $APP/frontend

    if [ "$DEPS" = "FORCE" ] || [ ! -d "node_modules" ]; then
        echo "  npm ci..."
        sudo -u $USR npm ci --silent 2>&1 | tail -2
    else
        echo "  Node deps: skip"
    fi

    echo "  Build..."
    export NODE_OPTIONS="--max-old-space-size=1536"
    sudo -u $USR -E npm run build 2>&1 | tail -3
    echo "  Dist: $(du -sh dist 2>/dev/null | cut -f1)"
else
    echo "[3/4] Frontend: skip"
fi

# Restart
echo "[4/4] Restart..."
# Write "success" into the status JSON BEFORE the restart.  systemd will
# SIGTERM this script as soon as the old unit starts stopping, so any
# status write after `systemctl restart` is unreliable.
finalise_status success "Update applied; restarting backend..."
systemctl restart arkmaniagest
sleep 2

if systemctl is-active --quiet arkmaniagest; then
    echo "  Backend: ATTIVO"
else
    echo "  Backend: ERRORE"
    journalctl -u arkmaniagest --no-pager -n 10
fi

if [ "$MODE" != "BACKEND" ]; then
    nginx -t 2>/dev/null && systemctl reload nginx && echo "  Nginx: OK"
fi

sleep 3
HEALTH=$(curl -sf http://127.0.0.1:8000/health 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "  Health: OK"
    echo "$HEALTH" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(f'  v{d.get(\"version\",\"?\")}  Panel DB: {d.get(\"db_ready\",\"?\")}  Plugin DB: {d.get(\"plugin_db_ready\",\"?\")}  PID: {d.get(\"pid\",\"?\")}')
except:
    pass
" 2>/dev/null || true
else
    echo "  Health: ERRORE"
    journalctl -u arkmaniagest --no-pager -n 5
fi

rm -rf $TMP
echo ""
echo "=== Update completato ==="
