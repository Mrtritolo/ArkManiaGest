#!/usr/bin/env bash
# ============================================
# ArkManiaGest - Server-side update script
# Eseguito dal PC locale via update-remote.ps1
# Argomenti: $1=MODE (FULL|BACKEND|FRONTEND)  $2=DEPS (AUTO|FORCE|SKIP)
# ============================================
set -e

MODE=${1:-FULL}
DEPS=${2:-AUTO}
APP=/opt/arkmaniagest
TMP=/tmp/arkmaniagest-update
USR=arkmania

echo ""
echo "=== ArkManiaGest Update ==="
echo "Mode: $MODE  Deps: $DEPS"
echo ""

# Estrai
rm -rf $TMP
mkdir -p $TMP
tar -xzf /tmp/arkmaniagest-update.tar.gz -C $TMP
rm -f /tmp/arkmaniagest-update.tar.gz

# Sync file
echo "[1/4] Sync file..."
# --delete removes files on the server that no longer exist in the source,
# keeping the production directory clean from leftovers of old deploys.
# Runtime directories (venv, node_modules, dist, data) and secrets (.env)
# are protected via --exclude so they are never touched.
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
    $TMP/ $APP/
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
