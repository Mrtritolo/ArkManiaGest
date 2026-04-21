#!/usr/bin/env bash
# ============================================
# ArkManiaGest — Full backup
# Usage: sudo bash backup.sh
# Backs up: .env, nginx config, SSL domain list
# ============================================
set -euo pipefail

APP_DIR="/opt/arkmaniagest"
BACKUP_DIR="/opt/arkmaniagest-backups"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
BACKUP_NAME="arkmaniagest_${TIMESTAMP}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

echo "============================================"
echo "  ArkManiaGest — Backup"
echo "  ${TIMESTAMP}"
echo "============================================"

mkdir -p "$BACKUP_PATH"

# .env lives in backend/ (contains JWT_SECRET and FIELD_ENCRYPTION_KEY — back up carefully)
if [ -f "$APP_DIR/backend/.env" ]; then
    cp "$APP_DIR/backend/.env" "$BACKUP_PATH/"
    echo "  [OK] .env"
fi

# Nginx config
if [ -f "/etc/nginx/sites-available/arkmaniagest" ]; then
    cp "/etc/nginx/sites-available/arkmaniagest" "$BACKUP_PATH/nginx.conf"
    echo "  [OK] Nginx config"
fi

# SSL certificates (just the domain list, not the keys)
if [ -d "/etc/letsencrypt/live" ]; then
    ls /etc/letsencrypt/live/ > "$BACKUP_PATH/ssl-domains.txt" 2>/dev/null
    echo "  [OK] SSL domains list"
fi

# Compress
cd "$BACKUP_DIR"
tar -czf "${BACKUP_NAME}.tar.gz" "$BACKUP_NAME"
rm -rf "$BACKUP_PATH"

# Retain only the last 20 backups
ls -t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | tail -n +21 | xargs -r rm

SIZE=$(du -sh "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" | cut -f1)
echo ""
echo "  Backup: ${BACKUP_DIR}/${BACKUP_NAME}.tar.gz ($SIZE)"
echo "  Total backups: $(ls "$BACKUP_DIR"/*.tar.gz 2>/dev/null | wc -l)"
echo ""
