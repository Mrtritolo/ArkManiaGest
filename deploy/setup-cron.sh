#!/usr/bin/env bash
# ============================================
# ArkManiaGest — Install cron jobs
# Usage: sudo bash setup-cron.sh
#
# Writes the canonical /etc/cron.d/arkmaniagest fence-block.  The same
# file is also created by full-deploy.sh at first install; running this
# script later reseats it without duplicating entries.
# ============================================
set -euo pipefail

APP_DIR="/opt/arkmaniagest"
CRON_FILE="/etc/cron.d/arkmaniagest"

echo "Installing cron jobs..."

# system-wide cron file -- atomic, no risk of duplication and safe to
# rerun (the whole file is rewritten every invocation).  /etc/cron.d
# entries require an explicit user column, hence the `root` field.
cat > "$CRON_FILE" << CRONS
# >>> arkmaniagest cron >>>
# Managed by deploy/setup-cron.sh and deploy/full-deploy.sh.
# Edit the script, not this file -- reruns will overwrite manual edits.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Daily backup at 03:00
0 3 * * * root /bin/bash ${APP_DIR}/deploy/backup.sh >> /var/log/arkmaniagest/backup-cron.log 2>&1

# Health check every 5 minutes -- restart panel if /health is down
*/5 * * * * root curl -sf http://127.0.0.1:8000/health > /dev/null || systemctl restart arkmaniagest

# Sync player names from .arkprofile -- daily at 04:30
30 4 * * * root /bin/bash ${APP_DIR}/deploy/cron-sync-names.sh
# <<< arkmaniagest cron <<<
CRONS

chmod 644 "$CRON_FILE"
chown root:root "$CRON_FILE"

# Strip any legacy entries lingering in the root user crontab from
# earlier versions of this script (which used `crontab -e` instead of
# /etc/cron.d).  Idempotent: a no-op when no such entries exist.
if crontab -l 2>/dev/null | grep -q arkmaniagest; then
    echo "  [INFO] removing legacy entries from root user crontab"
    (crontab -l 2>/dev/null | grep -v arkmaniagest) | crontab -
fi

echo "  [OK] Daily backup:        03:00"
echo "  [OK] Health check:        every 5 min"
echo "  [OK] Player names sync:   04:30"
echo ""
echo "Inspect: cat ${CRON_FILE}"
