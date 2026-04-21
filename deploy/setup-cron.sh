#!/usr/bin/env bash
# ============================================
# ArkManiaGest — Installa cron jobs
# Usage: sudo bash setup-cron.sh
# ============================================
set -euo pipefail

APP_DIR="/opt/arkmaniagest"

echo "Installazione cron jobs..."

# Backup giornaliero alle 03:00
CRON_BACKUP="0 3 * * * /bin/bash ${APP_DIR}/deploy/backup.sh >> /var/log/arkmaniagest/backup-cron.log 2>&1"

# Health check ogni 5 minuti, restart se down
CRON_HEALTH="*/5 * * * * curl -sf http://127.0.0.1:8000/health > /dev/null || systemctl restart arkmaniagest"

# Sync nomi giocatori da .arkprofile ogni giorno alle 04:30
CRON_SYNC="30 4 * * * /bin/bash ${APP_DIR}/deploy/cron-sync-names.sh"

# Scrivi crontab
(crontab -l 2>/dev/null | grep -v arkmaniagest; echo "$CRON_BACKUP"; echo "$CRON_HEALTH"; echo "$CRON_SYNC") | crontab -

echo "  [OK] Backup giornaliero: 03:00"
echo "  [OK] Health check: ogni 5 min"
echo "  [OK] Sync nomi giocatori: 04:30"
echo ""
echo "Verifica con: crontab -l"
