#!/usr/bin/env bash
# ============================================
# ArkManiaGest — Backup completo
# Usage: sudo bash backup.sh
# Crea backup di: vault, .env, nginx config
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

# SSL certificates (percorso, non chiavi)
if [ -d "/etc/letsencrypt/live" ]; then
    ls /etc/letsencrypt/live/ > "$BACKUP_PATH/ssl-domains.txt" 2>/dev/null
    echo "  [OK] SSL domains list"
fi

# Comprimi
cd "$BACKUP_DIR"
tar -czf "${BACKUP_NAME}.tar.gz" "$BACKUP_NAME"
rm -rf "$BACKUP_PATH"

# Mantieni ultimi 20 backup
ls -t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | tail -n +21 | xargs -r rm

SIZE=$(du -sh "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" | cut -f1)
echo ""
echo "  Backup: ${BACKUP_DIR}/${BACKUP_NAME}.tar.gz ($SIZE)"
echo "  Totale backup: $(ls "$BACKUP_DIR"/*.tar.gz 2>/dev/null | wc -l)"
echo ""
