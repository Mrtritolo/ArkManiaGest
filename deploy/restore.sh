#!/usr/bin/env bash
# ============================================
# ArkManiaGest — Restore from backup
# Usage: sudo bash restore.sh <backup_file.tar.gz>
# ============================================
set -euo pipefail

APP_DIR="/opt/arkmaniagest"
BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: sudo bash restore.sh <backup_file.tar.gz>"
    echo ""
    echo "Available backups:"
    ls -lh /opt/arkmaniagest-backups/*.tar.gz 2>/dev/null || echo "  No backup found."
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    # Fallback: try inside the standard backup dir
    BACKUP_FILE="/opt/arkmaniagest-backups/$BACKUP_FILE"
    if [ ! -f "$BACKUP_FILE" ]; then
        echo "ERROR: File not found: $1"
        exit 1
    fi
fi

echo "============================================"
echo "  ArkManiaGest — Restore"
echo "  From: $(basename $BACKUP_FILE)"
echo "============================================"
echo ""
read -p "WARNING: this will overwrite .env and the nginx config. Continue? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Stop the service
echo "Stopping service..."
systemctl stop arkmaniagest 2>/dev/null || true

# Extract the backup into a temp dir
TEMP_DIR=$(mktemp -d)
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"
BACKUP_DIR=$(ls "$TEMP_DIR")

# Restore .env (backend/ — contains JWT_SECRET and FIELD_ENCRYPTION_KEY)
if [ -f "$TEMP_DIR/$BACKUP_DIR/.env" ]; then
    cp "$TEMP_DIR/$BACKUP_DIR/.env" "$APP_DIR/backend/.env"
    chown arkmania:arkmania "$APP_DIR/backend/.env"
    chmod 600 "$APP_DIR/backend/.env"
    echo "  [OK] .env restored"
fi

# Restore nginx
if [ -f "$TEMP_DIR/$BACKUP_DIR/nginx.conf" ]; then
    cp "$TEMP_DIR/$BACKUP_DIR/nginx.conf" /etc/nginx/sites-available/arkmaniagest
    nginx -t && systemctl reload nginx
    echo "  [OK] Nginx config restored"
fi

# Cleanup temp
rm -rf "$TEMP_DIR"

# Restart the service
echo "Restarting service..."
systemctl start arkmaniagest

sleep 2
if systemctl is-active --quiet arkmaniagest; then
    echo ""
    echo "  Restore completed. Service active."
else
    echo ""
    echo "  WARNING: service is not running. Check the logs:"
    echo "  journalctl -u arkmaniagest -n 20"
fi
echo ""
