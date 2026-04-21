#!/usr/bin/env bash
# ============================================
# ArkManiaGest — Cron Sync Player Names
# Scans .arkprofile files, updates names in DB.
# Runs daily via crontab.
# ============================================
set -euo pipefail

# Source shared configuration (real file first, template fallback)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/deploy.conf" ]; then
    source "${SCRIPT_DIR}/deploy.conf"
elif [ -f "${SCRIPT_DIR}/deploy.conf.example" ]; then
    source "${SCRIPT_DIR}/deploy.conf.example"
fi

# Read cron secret: prefer deploy.conf, fall back to backend .env
if [ -n "${CRON_SYNC_SECRET:-}" ]; then
    CRON_SECRET="$CRON_SYNC_SECRET"
elif [ -f "${APP_DIR:-/opt/arkmaniagest}/backend/.env" ]; then
    CRON_SECRET=$(grep -oP '^CRON_SECRET=\K.*' "${APP_DIR}/backend/.env" 2>/dev/null || echo "")
fi

if [ -z "${CRON_SECRET:-}" ]; then
    echo "ERROR: CRON_SECRET not found in deploy.conf or backend/.env"
    exit 1
fi

API_URL="http://127.0.0.1:8000/api/v1/public/cron/sync-names?secret=${CRON_SECRET}"
LOG_FILE="${LOG_DIR:-/var/log/arkmaniagest}/sync-names.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

mkdir -p "$(dirname "$LOG_FILE")"

echo "[$TIMESTAMP] Starting player name sync..." >> "$LOG_FILE"

# Verify the service is running
if ! curl -sf http://127.0.0.1:8000/health > /dev/null 2>&1; then
    echo "[$TIMESTAMP] ERROR: ArkManiaGest service not reachable" >> "$LOG_FILE"
    exit 1
fi

# Execute the sync
RESPONSE=$(curl -sf -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    --max-time 300 \
    2>&1) || {
    echo "[$TIMESTAMP] ERROR: curl failed: $RESPONSE" >> "$LOG_FILE"
    exit 1
}

echo "[$TIMESTAMP] Result: $RESPONSE" >> "$LOG_FILE"

# Extract key numbers from JSON
UPDATED=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(f'Profiles: {d.get(\"total_profiles_scanned\",0)} | Match: {d.get(\"matched\",0)} | Updated: {d.get(\"updated\",0)} | Errors: {len(d.get(\"errors\",[]))}')
except:
    print('Response parsing failed')
" 2>/dev/null || echo "Parse error")

echo "[$TIMESTAMP] $UPDATED" >> "$LOG_FILE"
echo "[$TIMESTAMP] Sync completed." >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# Log rotation: keep only the last 1000 lines
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 1000 ]; then
    tail -500 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi
