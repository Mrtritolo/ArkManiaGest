#!/usr/bin/env bash
# ============================================
# ArkManiaGest — Restore da backup
# Usage: sudo bash restore.sh <backup_file.tar.gz>
# ============================================
set -euo pipefail

APP_DIR="/opt/arkmaniagest"
BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: sudo bash restore.sh <backup_file.tar.gz>"
    echo ""
    echo "Backup disponibili:"
    ls -lh /opt/arkmaniagest-backups/*.tar.gz 2>/dev/null || echo "  Nessun backup trovato."
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    # Prova nel dir backup
    BACKUP_FILE="/opt/arkmaniagest-backups/$BACKUP_FILE"
    if [ ! -f "$BACKUP_FILE" ]; then
        echo "ERRORE: File non trovato: $1"
        exit 1
    fi
fi

echo "============================================"
echo "  ArkManiaGest — Restore"
echo "  Da: $(basename $BACKUP_FILE)"
echo "============================================"
echo ""
read -p "ATTENZIONE: Questo sovrascrivera' vault e .env. Continuare? (s/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Ss]$ ]]; then
    echo "Annullato."
    exit 0
fi

# Ferma servizio
echo "Fermando servizio..."
systemctl stop arkmaniagest 2>/dev/null || true

# Estrai backup in temp
TEMP_DIR=$(mktemp -d)
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"
BACKUP_DIR=$(ls "$TEMP_DIR")

# Restore .env (backend/ — contains JWT_SECRET and FIELD_ENCRYPTION_KEY)
if [ -f "$TEMP_DIR/$BACKUP_DIR/.env" ]; then
    cp "$TEMP_DIR/$BACKUP_DIR/.env" "$APP_DIR/backend/.env"
    chown arkmania:arkmania "$APP_DIR/backend/.env"
    chmod 600 "$APP_DIR/backend/.env"
    echo "  [OK] .env ripristinato"
fi

# Restore nginx
if [ -f "$TEMP_DIR/$BACKUP_DIR/nginx.conf" ]; then
    cp "$TEMP_DIR/$BACKUP_DIR/nginx.conf" /etc/nginx/sites-available/arkmaniagest
    nginx -t && systemctl reload nginx
    echo "  [OK] Nginx config ripristinato"
fi

# Cleanup temp
rm -rf "$TEMP_DIR"

# Riavvia servizio
echo "Riavvio servizio..."
systemctl start arkmaniagest

sleep 2
if systemctl is-active --quiet arkmaniagest; then
    echo ""
    echo "  Restore completato. Servizio attivo."
else
    echo ""
    echo "  ATTENZIONE: Servizio non si avvia. Controlla i log:"
    echo "  journalctl -u arkmaniagest -n 20"
fi
echo ""
