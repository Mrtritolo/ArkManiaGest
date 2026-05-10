#!/usr/bin/env bash
# ============================================
# ArkManiaGest — Full backup
# Usage: sudo bash backup.sh
# Backs up: .env, nginx config, SSL domain list, panel DB, plugin DB,
# backend/data/.  The resulting tarball is chmod 600 because it contains
# JWT_SECRET / FIELD_ENCRYPTION_KEY (in .env) and the encrypted SSH /
# Discord credentials (in the DB dump).
# ============================================
set -euo pipefail

APP_DIR="/opt/arkmaniagest"
BACKUP_DIR="/opt/arkmaniagest-backups"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
BACKUP_NAME="arkmaniagest_${TIMESTAMP}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

# Lock file: serialise concurrent invocations from cron + manual run.
LOCKFILE="/var/lock/arkmaniagest-backup.lock"
exec 9>"$LOCKFILE"
if ! flock -n 9; then
    echo "  [SKIP] another backup is in progress (locked: $LOCKFILE)" >&2
    exit 0
fi

echo "============================================"
echo "  ArkManiaGest — Backup"
echo "  ${TIMESTAMP}"
echo "============================================"

mkdir -p "$BACKUP_PATH"
chmod 700 "$BACKUP_PATH"

# .env lives in backend/ (contains JWT_SECRET and FIELD_ENCRYPTION_KEY — back up carefully)
if [ -f "$APP_DIR/backend/.env" ]; then
    cp "$APP_DIR/backend/.env" "$BACKUP_PATH/"
    chmod 600 "$BACKUP_PATH/.env"
    echo "  [OK] .env"
fi

# Database dumps -- both panel + plugin.  Read DSNs from backend/.env
# instead of hardcoding so a single source of truth wins.
ENV_FILE="$APP_DIR/backend/.env"
get_env() {
    [ -f "$ENV_FILE" ] || return 1
    local key="$1"
    sed -n "s/^${key}=//p" "$ENV_FILE" | head -1
}

dump_db() {
    local label="$1" host="$2" port="$3" user="$4" password="$5" name="$6"
    [ -n "$host" ] && [ -n "$user" ] && [ -n "$password" ] && [ -n "$name" ] || {
        echo "  [SKIP] ${label} DB dump (host/user/password/name missing in .env)"
        return
    }
    local out="$BACKUP_PATH/${label}.sql.gz"
    # Use a defaults-extra-file so the password never lands in `ps`.
    local creds
    creds=$(mktemp)
    chmod 600 "$creds"
    cat > "$creds" <<EOF
[client]
host=$host
port=$port
user=$user
password=$password
EOF
    if mysqldump --defaults-extra-file="$creds" \
        --single-transaction --skip-lock-tables \
        --no-tablespaces \
        "$name" 2>/dev/null | gzip > "$out"
    then
        chmod 600 "$out"
        echo "  [OK] ${label} DB ($name)"
    else
        echo "  [WARN] ${label} DB dump failed ($name) -- partial backup"
        rm -f "$out"
    fi
    rm -f "$creds"
}

PANEL_HOST=$(get_env DB_HOST || echo localhost)
PANEL_PORT=$(get_env DB_PORT || echo 3306)
PANEL_USER=$(get_env DB_USER || echo root)
PANEL_PASS=$(get_env DB_PASSWORD || echo "")
PANEL_NAME=$(get_env DB_NAME || echo arkmaniagest)

PLUGIN_HOST=$(get_env PLUGIN_DB_HOST || echo "")
PLUGIN_PORT=$(get_env PLUGIN_DB_PORT || echo "")
PLUGIN_USER=$(get_env PLUGIN_DB_USER || echo "")
PLUGIN_PASS=$(get_env PLUGIN_DB_PASSWORD || echo "")
PLUGIN_NAME=$(get_env PLUGIN_DB_NAME || echo "")

dump_db "panel" "$PANEL_HOST" "$PANEL_PORT" "$PANEL_USER" "$PANEL_PASS" "$PANEL_NAME"

# Plugin DB: dump only when configured separately (otherwise it's the
# same DSN as panel and the panel dump above already covers it).
if [ -n "$PLUGIN_HOST" ] && [ -n "$PLUGIN_NAME" ]; then
    dump_db "plugin" \
        "$PLUGIN_HOST" "${PLUGIN_PORT:-3306}" "$PLUGIN_USER" "$PLUGIN_PASS" "$PLUGIN_NAME"
fi

# Runtime data (audit logs, blueprint cache, etc.) -- fast-changing,
# small, but expensive to rebuild from scratch.
if [ -d "$APP_DIR/backend/data" ]; then
    tar -C "$APP_DIR/backend" -czf "$BACKUP_PATH/data.tar.gz" data
    chmod 600 "$BACKUP_PATH/data.tar.gz"
    echo "  [OK] backend/data"
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

# Compress.  The tarball inherits 600 from `umask 077` below so the
# encrypted secrets in .env / DB dump never become world-readable on
# the backup partition.
umask 077
cd "$BACKUP_DIR"
tar -czf "${BACKUP_NAME}.tar.gz" "$BACKUP_NAME"
chmod 600 "${BACKUP_NAME}.tar.gz"
rm -rf "$BACKUP_PATH"

# Retain only the last 20 backups
ls -t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | tail -n +21 | xargs -r rm

SIZE=$(du -sh "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" | cut -f1)
echo ""
echo "  Backup: ${BACKUP_DIR}/${BACKUP_NAME}.tar.gz ($SIZE)"
echo "  Total backups: $(ls "$BACKUP_DIR"/*.tar.gz 2>/dev/null | wc -l)"
echo ""
