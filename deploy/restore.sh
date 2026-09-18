#!/usr/bin/env bash
# ============================================
# ArkManiaGest — Restore from backup
# Usage: sudo bash restore.sh <backup_file.tar.gz>
# Restores .env and the nginx config, then -- one confirmation each --
# backend/data/ and the database dumps that backup.sh put in the archive.
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
echo "  From: $(basename "$BACKUP_FILE")"
echo "============================================"
echo ""

# Extract before stopping anything: under set -e a corrupt archive used to
# abort here with the service already stopped.
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"
SRC="$TEMP_DIR/$(ls "$TEMP_DIR")"

confirm() {
    local reply
    # Read the whole line: with -n 1 the Enter after "y" was left queued and
    # taken as "no" by the next prompt, silently skipping a restore step.
    read -r -p "$1 (y/N) " reply || true
    [[ $reply =~ ^[Yy]([Ee][Ss])?$ ]]
}

if ! confirm "WARNING: this will overwrite .env and the nginx config. Continue?"; then
    echo "Aborted."
    exit 0
fi

# backup.sh also archives backend/data/ and the database dumps; restoring
# only .env + nginx and then reporting "Restore completed" left the panel on
# its current data.  Ask for each here, before the service goes down.
RESTORE_DATA=0; RESTORE_PANEL_DB=0; RESTORE_PLUGIN_DB=0
if [ -f "$SRC/data.tar.gz" ] && confirm "Also restore backend/data/?"; then
    RESTORE_DATA=1
fi
if [ -f "$SRC/panel.sql.gz" ] && confirm "Also restore the panel database? Every table in the dump is replaced (with a single database, the plugin tables too)."; then
    RESTORE_PANEL_DB=1
fi
if [ -f "$SRC/plugin.sql.gz" ] && confirm "Also restore the plugin database? Stop the game servers first: every table in the dump is replaced."; then
    RESTORE_PLUGIN_DB=1
fi

# Stop the service
echo "Stopping service..."
systemctl stop arkmaniagest 2>/dev/null || true
WARNINGS=0

# Restore .env (backend/ — contains JWT_SECRET and FIELD_ENCRYPTION_KEY)
if [ -f "$SRC/.env" ]; then
    cp "$SRC/.env" "$APP_DIR/backend/.env"
    chown arkmania:arkmania "$APP_DIR/backend/.env"
    chmod 600 "$APP_DIR/backend/.env"
    echo "  [OK] .env restored"
fi

# Restore nginx.  A config failing nginx -t used to stay in place (after an
# "[OK]"), and nginx then refused to start at the next reboot.
if [ -f "$SRC/nginx.conf" ]; then
    NGINX_CONF=/etc/nginx/sites-available/arkmaniagest
    if [ -f "$NGINX_CONF" ]; then
        cp "$NGINX_CONF" "$TEMP_DIR/nginx.current"
    fi
    cp "$SRC/nginx.conf" "$NGINX_CONF"
    if nginx -t; then
        systemctl reload nginx
        echo "  [OK] Nginx config restored"
    else
        if [ -f "$TEMP_DIR/nginx.current" ]; then
            cp "$TEMP_DIR/nginx.current" "$NGINX_CONF"
        else
            rm -f "$NGINX_CONF"
        fi
        echo "  [WARN] the backed-up nginx config fails nginx -t -- not restored"
        WARNINGS=1
    fi
fi

if [ "$RESTORE_DATA" = 1 ]; then
    tar -xzf "$SRC/data.tar.gz" -C "$APP_DIR/backend"
    chown -R arkmania:arkmania "$APP_DIR/backend/data"
    echo "  [OK] backend/data restored"
fi

# Database dumps go back with the credentials of the .env now in place.
ENV_FILE="$APP_DIR/backend/.env"
get_env() {
    [ -f "$ENV_FILE" ] || return 0
    sed -n "s/^$1=//p" "$ENV_FILE" | head -1
}

# Option-file value, double-quoted with \ and " escaped (see backup.sh).
optval() {
    local v="${1//\\/\\\\}"
    printf '"%s"' "${v//\"/\\\"}"
}

load_db() {
    local label="$1" host="$2" port="$3" user="$4" password="$5" name="$6"
    if [ -z "$host" ] || [ -z "$user" ] || [ -z "$password" ] || [ -z "$name" ]; then
        echo "  [WARN] ${label} DB not restored: host/user/password/name missing in .env"
        WARNINGS=1
        return
    fi
    # A defaults-extra-file keeps the password out of `ps`.
    local creds
    creds=$(mktemp "$TEMP_DIR/db.XXXXXX")
    cat > "$creds" <<EOF
[client]
host=$host
port=${port:-3306}
user=$(optval "$user")
password=$(optval "$password")
EOF
    if gunzip -c "$SRC/${label}.sql.gz" | mysql --defaults-extra-file="$creds" "$name"; then
        echo "  [OK] ${label} DB restored ($name)"
    else
        echo "  [WARN] ${label} DB restore failed ($name)"
        WARNINGS=1
    fi
    rm -f "$creds"
}

if [ "$RESTORE_PANEL_DB" = 1 ]; then
    load_db panel "$(get_env DB_HOST)" "$(get_env DB_PORT)" \
        "$(get_env DB_USER)" "$(get_env DB_PASSWORD)" "$(get_env DB_NAME)"
fi
if [ "$RESTORE_PLUGIN_DB" = 1 ]; then
    load_db plugin "$(get_env PLUGIN_DB_HOST)" "$(get_env PLUGIN_DB_PORT)" \
        "$(get_env PLUGIN_DB_USER)" "$(get_env PLUGIN_DB_PASSWORD)" "$(get_env PLUGIN_DB_NAME)"
fi

# Restart the service
echo "Restarting service..."
systemctl start arkmaniagest

sleep 2
if systemctl is-active --quiet arkmaniagest; then
    echo ""
    if [ "$WARNINGS" = 1 ]; then
        echo "  Restore finished with warnings (see above). Service active."
    else
        echo "  Restore completed. Service active."
    fi
else
    echo ""
    echo "  WARNING: service is not running. Check the logs:"
    echo "  journalctl -u arkmaniagest -n 20"
fi
echo ""
