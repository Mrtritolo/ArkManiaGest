#!/usr/bin/env bash
# ============================================
# ArkManiaGest - Server-side update script
# Run locally by update-panel.{ps1,sh} OR by the in-UI self-updater
# (POST /api/v1/system-update/install).  Argomenti:
#   $1=MODE  (FULL|BACKEND|FRONTEND)
#   $2=DEPS  (AUTO|FORCE|SKIP)
# ============================================
set -euo pipefail

MODE=${1:-FULL}
DEPS=${2:-AUTO}
APP=/opt/arkmaniagest
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
    python3 - "$STATUS_FILE" "$state" "$msg" "$USR" <<'PYEOF' 2>/dev/null || true
import json, os, pwd, sys, datetime
path, state, msg, owner = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
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
# Hand the file back to the panel user.  /tmp is sticky, so a root-owned
# status file could be neither rewritten nor renamed over by the panel.
try:
    pw = pwd.getpwnam(owner)
    os.chown(tmp, pw.pw_uid, pw.pw_gid)
except (KeyError, OSError):
    pass
os.replace(tmp, path)
PYEOF
}
# Any non-zero exit from this point on is reported as a failed update.
trap 'rc=$?; finalise_status failed "server-update.sh exited with code $rc"' ERR

echo ""
echo "=== ArkManiaGest Update ==="
echo "Mode: $MODE  Deps: $DEPS"
echo ""

# A run killed outright -- systemd stopping the panel whose cgroup we live
# in, or the OOM killer during `npm ci` -- never reaches the traps below,
# and with a random name per run nothing else would ever reclaim its source
# tree and npm cache.  Sweep what earlier runs left behind: `rm -rf` unlinks
# a planted symlink instead of following it.
# NOTE: the glob must not be able to match the uploaded tarball
# (/tmp/arkmaniagest-update.tar.gz): '.??????' matches '.tar.gz'
# exactly, which deleted the archive right before we untar it.
# Hence the distinct -src prefix below.
rm -rf /tmp/arkmaniagest-update-src.?????? 2>/dev/null || true

# Extract.  Root untars here and rsyncs --delete from here into $APP, so the
# directory gets an unpredictable name: with a fixed /tmp path any local
# user could plant a symlink between an `rm -rf` and a `mkdir -p`.  0755
# (mktemp creates 0700) keeps $TMP/npm-cache reachable for $USR, and rsync
# -a copies this mode onto $APP when a dev tarball has files at its root.
TMP=$(mktemp -d /tmp/arkmaniagest-update-src.XXXXXX)
chmod 0755 "$TMP"
# Every run gets its own directory now, so a failed run must not leave one.
trap 'rm -rf "$TMP"' EXIT
tar -xzf /tmp/arkmaniagest-update.tar.gz -C "$TMP"
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
    --exclude='deploy/deploy.conf' \
    --exclude='frontend/dist' \
    --exclude='_deprecated/' \
    --exclude='config/' \
    --exclude='tests/' \
    --exclude='Specifiche/' \
    --exclude='reference/' \
    "$ROOT"/ "$APP"/

# Clean up orphan release-bundle directory if it was dropped by a
# previous broken update run.  Use a nullglob-protected loop so that
# when no orphans exist we don't iterate over the literal pattern.
shopt -s nullglob
for ORPHAN in "$APP"/arkmaniagest-v*/; do
    [ -d "$ORPHAN" ] || continue
    echo "  Removing orphan bundle dir: $ORPHAN"
    rm -rf "$ORPHAN"
done
shopt -u nullglob
chown -R "$USR:$USR" "$APP"

# Strip Windows CRLF from all shell scripts synced from the Windows tar archive.
find "$APP/deploy" -name "*.sh" -exec sed -i 's/\r//g' {} \;

# Append any new keys from the template to the live .env (idempotent).
bash "$APP/deploy/migrate-env.sh" "$APP" || true
chown "$USR:$USR" "$APP/backend/.env"
chmod 600 "$APP/backend/.env"

# certbot renewal hook, as full-deploy.sh writes it: installs from before it
# existed renew the certificate without nginx ever loading it.  Best effort:
# inside the unit's ProtectSystem=strict namespace (in-UI updater)
# /etc/letsencrypt is read-only, and that must not fail the update.
HOOK=/etc/letsencrypt/renewal-hooks/deploy/arkmaniagest-reload-nginx
if [ -d /etc/letsencrypt ] && [ ! -x "$HOOK" ]; then
    { mkdir -p "$(dirname "$HOOK")" \
        && printf '#!/bin/sh\nnginx -t && systemctl reload nginx\n' > "$HOOK" \
        && chmod 755 "$HOOK"; } 2>/dev/null \
        || echo "  certbot renewal hook not installed (read-only /etc/letsencrypt): an update-panel.{sh,ps1} run installs it"
fi

# Re-seat /etc/cron.d/arkmaniagest.  Only setup-cron.sh writes it and only
# full-deploy.sh calls that, so a code update left the previous release's
# entries running -- including the health check that restarts the panel
# while restore.sh has it deliberately stopped.  The script is idempotent
# and needs no deploy.conf.  Only reseat a block that is already installed,
# so a host where the operator removed it keeps it removed.  Best effort:
# /etc/cron.d is read-only inside the unit's ProtectSystem=strict namespace
# (in-UI updater), and that must not fail the update.
if [ -f /etc/cron.d/arkmaniagest ]; then
    bash "$APP/deploy/setup-cron.sh" >/dev/null 2>&1 \
        || echo "  cron entries not refreshed (read-only /etc/cron.d): run deploy/setup-cron.sh by hand"
fi
echo "  OK"

# Backend
if [ "$MODE" != "FRONTEND" ]; then
    echo "[2/4] Backend..."
    cd "$APP/backend"

    if [ ! -d "venv" ]; then
        sudo -u "$USR" python3 -m venv venv
    fi

    # AUTO reinstalls whenever requirements.txt differs from the last
    # install.  The marker used to be a bare "installed once" flag, so the
    # in-UI updater (always AUTO) never installed a dependency added by a
    # later release and the restarted backend died on the import.
    REQ_HASH=$(sha256sum requirements.txt | cut -d' ' -f1)
    if [ "$DEPS" = "FORCE" ] || { [ "$DEPS" = "AUTO" ] && [ "$(cat venv/.deps_installed 2>/dev/null)" != "$REQ_HASH" ]; }; then
        echo "  pip install..."
        sudo -u "$USR" venv/bin/pip install -q --upgrade pip
        sudo -u "$USR" venv/bin/pip install -q -r requirements.txt
        echo "$REQ_HASH" > venv/.deps_installed
    else
        echo "  Deps: skip"
    fi

    # Aggiorna systemd service
    cp "$APP/deploy/arkmaniagest.service" /etc/systemd/system/arkmaniagest.service
    systemctl daemon-reload
    echo "  OK"
else
    echo "[2/4] Backend: skip"
fi

# Frontend
if [ "$MODE" != "BACKEND" ]; then
    echo "[3/4] Frontend..."
    cd "$APP/frontend"

    # Same for package-lock.json: AUTO used to skip npm ci as soon as
    # node_modules existed, so a release adding a frontend package failed
    # its build.  A node_modules from before this marker existed reads as
    # an empty hash, which is a mismatch, so npm ci runs once on the first
    # upgrade that carries the marker: stamping the CURRENT hash there
    # instead skipped the install on exactly the release that added a
    # package, on the retry too, because the stamp already matched.
    LOCK_HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
    if [ "$DEPS" = "FORCE" ] || [ ! -d "node_modules" ] \
        || { [ "$DEPS" = "AUTO" ] && [ "$(cat node_modules/.deps_installed 2>/dev/null)" != "$LOCK_HASH" ]; }; then
        echo "  npm ci..."
        # The in-UI updater runs inside the unit's ProtectSystem=strict
        # namespace, where the home directory holding npm's default cache
        # is read-only: npm ci failed there on every lock change.
        install -d -o "$USR" -g "$USR" "$TMP/npm-cache"
        sudo -u "$USR" npm ci --silent --cache "$TMP/npm-cache" 2>&1 | tail -2
        echo "$LOCK_HASH" > node_modules/.deps_installed
    else
        echo "  Node deps: skip"
    fi

    echo "  Build..."
    export NODE_OPTIONS="--max-old-space-size=1536"
    sudo -u "$USR" -E npm run build 2>&1 | tail -3
    echo "  Dist: $(du -sh dist 2>/dev/null | cut -f1)"
else
    echo "[3/4] Frontend: skip"
fi

# Nothing below uses $TMP: remove it before the restart signals this
# script, rather than leave it to the EXIT trap of a process being killed.
rm -rf "$TMP"

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
# Capture exit code BEFORE testing it: with `set -e` we must not rely on $?
# in a separate statement.  Use `|| HEALTH=""` to allow curl to fail without
# aborting the script (we report ERRORE explicitly below).
HEALTH=$(curl -sf http://127.0.0.1:8000/health 2>/dev/null || true)
if [ -n "$HEALTH" ]; then
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

echo ""
echo "=== Update completato ==="
