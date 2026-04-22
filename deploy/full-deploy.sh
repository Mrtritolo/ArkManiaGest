#!/usr/bin/env bash
# ============================================
# ArkManiaGest -- Full Deploy (background-safe)
# All parameters are read from deploy.conf
# ============================================
export DEBIAN_FRONTEND=noninteractive

# Source shared configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_CONF_CANDIDATES=(
    "${SCRIPT_DIR}/deploy.conf"
    "/tmp/arkmaniagest-deploy/deploy/deploy.conf"
    "${SCRIPT_DIR}/deploy.conf.example"
    "/tmp/arkmaniagest-deploy/deploy/deploy.conf.example"
)
CONF_FILE=""
for _c in "${_CONF_CANDIDATES[@]}"; do
    if [ -f "$_c" ]; then
        CONF_FILE="$_c"
        break
    fi
done
if [ -z "$CONF_FILE" ]; then
    echo "ERROR: neither deploy.conf nor deploy.conf.example was found. Cannot proceed."
    exit 1
fi
if [[ "$CONF_FILE" == *.example ]]; then
    echo "WARNING: using deploy.conf.example (template). Copy it to"
    echo "         deploy/deploy.conf and fill in real values for this host."
fi
# shellcheck source=deploy.conf.example
source "$CONF_FILE"

EMAIL="${SSL_EMAIL}"
DEPLOY_SRC="/tmp/arkmaniagest-deploy"
LOG="/tmp/arkmaniagest-deploy.log"

# All output goes to the log
exec > >(tee -a "$LOG") 2>&1

echo ""
echo "================================================"
echo "  ArkManiaGest -- Full Production Deploy"
echo "  Dominio: ${DOMAIN}"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "================================================"
echo ""

# =============================================
# PHASE 1: PACKAGES
# =============================================
echo "=== PHASE 1/9: System packages ==="

apt-get update -qq
apt-get upgrade -y -qq

apt-get install -y -qq \
    python3 python3-pip python3-venv python3-dev \
    build-essential rsync \
    nginx \
    certbot python3-certbot-nginx \
    fail2ban \
    ufw \
    curl wget git \
    logrotate \
    jq || true

# GeoIP2 module (may not be available, do not block on failure)
apt-get install -y -qq libnginx-mod-http-geoip2 2>/dev/null || echo "  WARNING: libnginx-mod-http-geoip2 not available, GeoIP will be configured later"

# Node.js 20 LTS
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 18 ]]; then
    echo "  Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
    apt-get install -y -qq nodejs
fi

# Upgrade npm to the latest release on top of NodeSource's bundled one —
# NodeSource lags behind npm's own release cadence, so a "new major version
# of npm available" notice would otherwise pop up on every install.
if command -v npm &>/dev/null; then
    echo "  Upgrading npm to latest..."
    npm install -g npm@latest 2>&1 | tail -1 || true
fi

echo "  Python: $(python3 --version)"
echo "  Node:   $(node --version 2>/dev/null || echo 'N/A')"
echo "  npm:    $(npm --version 2>/dev/null || echo 'N/A')"

# Swap per build
SWAP_SIZE=$(free -m | awk '/^Swap:/{print $2}')
if [ "${SWAP_SIZE:-0}" -lt 512 ]; then
    echo "  Creating 1GB swap..."
    if [ ! -f /swapfile ]; then
        fallocate -l 1G /swapfile
        chmod 600 /swapfile
        mkswap /swapfile >/dev/null
        swapon /swapfile
        grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    else
        swapon /swapfile 2>/dev/null || true
    fi
fi
echo "  RAM: $(free -m | awk '/^Mem:/{print $2}')MB  Swap: $(free -m | awk '/^Swap:/{print $2}')MB"
echo "  PHASE 1 OK"
echo ""

# =============================================
# PHASE 2: USER + DIRECTORY
# =============================================
echo "=== PHASE 2/9: User and directory ==="

id "$APP_USER" &>/dev/null || useradd -r -m -s /bin/bash "$APP_USER"
mkdir -p "$APP_DIR" "$LOG_DIR" "$BACKUP_DIR" /var/www/certbot
mkdir -p "$APP_DIR/backend/data"

echo "  PHASE 2 OK"
echo ""

# =============================================
# PHASE 3: FILE COPY
# =============================================
echo "=== PHASE 3/9: Copy project files ==="

# --delete removes files on the server that no longer exist in the source,
# keeping the production directory clean from leftovers of old deploys.
# Runtime directories (venv, node_modules, dist, data) and secrets (.env)
# are protected via --exclude so they are never touched.
rsync -a --delete \
    --exclude='node_modules' \
    --exclude='venv' \
    --exclude='__pycache__' \
    --exclude='.git' \
    --exclude='data/' \
    --exclude='*.vault' \
    --exclude='.env' \
    --exclude='frontend/dist' \
    --exclude='Specifiche/' \
    --exclude='_deprecated/' \
    --exclude='config/' \
    --exclude='tests/' \
    --exclude='reference/' \
    "${DEPLOY_SRC}/" "$APP_DIR/"

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$LOG_DIR"
chmod 750 "$APP_DIR/backend/data"

# Strip Windows CRLF from all shell scripts in deploy/ -- the tar archive was
# created on Windows and every .sh will have \r\n line endings without this step.
find "$APP_DIR/deploy" -name "*.sh" -exec sed -i 's/\r//g' {} \;
echo "  Shell scripts: CRLF stripped"
echo "  PHASE 3 OK"
echo ""

# =============================================
# PHASE 4: BACKEND
# =============================================
echo "=== PHASE 4/9: Python backend ==="

cd "$APP_DIR/backend"

if [ ! -d "venv" ]; then
    sudo -u "$APP_USER" python3 -m venv venv
    echo "  venv created"
fi

sudo -u "$APP_USER" venv/bin/pip install -q --upgrade pip 2>&1 | tail -1
sudo -u "$APP_USER" venv/bin/pip install -q -r requirements.txt 2>&1 | tail -1
echo "  PHASE 4 OK"
echo ""

# =============================================
# PHASE 5: FRONTEND
# =============================================
echo "=== PHASE 5/9: Frontend build ==="

cd "$APP_DIR/frontend"

echo "  npm ci in corso..."
sudo -u "$APP_USER" npm ci 2>&1 | tail -5
echo "  npm ci completed"

echo "  vite build in corso..."
export NODE_OPTIONS="--max-old-space-size=1536"
sudo -u "$APP_USER" -E npm run build 2>&1
BUILD_EXIT=$?

if [ $BUILD_EXIT -eq 0 ] && [ -d "dist" ]; then
    echo "  Build OK: $(du -sh dist | cut -f1)"
else
    echo "  BUILD ERROR (exit code: $BUILD_EXIT)"
    echo "  frontend/ contents:"
    ls -la
fi
echo "  PHASE 5 COMPLETED"
echo ""

# =============================================
# PHASE 6: SERVICE CONFIGURATION
# =============================================
echo "=== PHASE 6/9: Service configuration ==="

cd "$APP_DIR"

# .env must live in backend/ so that uvicorn (WorkingDirectory=backend/) and
# pydantic_settings (env_file=".env") both resolve to the same file.
if [ ! -f "backend/.env" ]; then
    cp deploy/.env.production backend/.env
    chown "$APP_USER:$APP_USER" backend/.env
    chmod 600 backend/.env
    echo "  .env created in backend/"
else
    echo "  .env exists (backend/) -- checking for missing keys"
    bash deploy/migrate-env.sh "$APP_DIR" || true
    chown "$APP_USER:$APP_USER" backend/.env
    chmod 600 backend/.env
fi

# Systemd
cp deploy/arkmaniagest.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable arkmaniagest 2>/dev/null
echo "  Systemd installato"

# Logrotate
cat > /etc/logrotate.d/arkmaniagest << 'EOF'
/var/log/arkmaniagest/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 arkmania arkmania
}
EOF

# Start backend
systemctl restart arkmaniagest
sleep 3
if systemctl is-active --quiet arkmaniagest; then
    echo "  Backend RUNNING"
else
    echo "  Backend ERROR -- log:"
    journalctl -u arkmaniagest --no-pager -n 10
fi
echo "  PHASE 6 OK"
echo ""

# =============================================
# PHASE 7: NGINX + SSL
# =============================================
echo "=== PHASE 7/9: Nginx + SSL ==="

rm -f /etc/nginx/sites-enabled/default

# Remove any stale symlinks in sites-enabled (e.g. typos like 'akmaniagest')
# before creating the canonical one.  A broken symlink here will prevent
# Nginx from starting after a server reboot.
find /etc/nginx/sites-enabled/ -maxdepth 1 -name '*arkmania*' -o -name '*akmania*' | xargs rm -f 2>/dev/null

# Initial HTTP config (replace placeholders)
sed -e "s|__DOMAIN__|${DOMAIN}|g" deploy/nginx-initial.conf > /etc/nginx/sites-available/arkmaniagest
ln -sf /etc/nginx/sites-available/arkmaniagest /etc/nginx/sites-enabled/arkmaniagest

if nginx -t 2>&1; then
    systemctl reload nginx
    echo "  Nginx HTTP attivo"
else
    echo "  Nginx config error!"
    nginx -t
fi

# SSL
echo "  Richiesta certificato SSL..."
mkdir -p /var/www/certbot
certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --non-interactive 2>&1 | tail -5

if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    echo "  SSL OTTENUTO"
    SSL_OK=1
else
    echo "  SSL FAILED -- check DNS"
    SSL_OK=0
fi
echo "  PHASE 7 OK"
echo ""

# =============================================
# PHASE 8: GEOIP + NGINX PRODUCTION
# =============================================
echo "=== PHASE 8/9: GeoIP + Nginx production ==="

# Download GeoIP DB (db-ip.com, free country-level database).
# db-ip publishes the new month's DB a few days after the first, so on
# early-in-the-month deploys we may need to fall back a couple of
# months.  We try the current month and then the previous 3 months.
mkdir -p /usr/share/GeoIP
GEOIP_OK=0

GEOIP_MONTHS=()
GEOIP_MONTHS+=("$(date -u +%Y-%m)")
for OFFSET in 1 2 3; do
    GEOIP_MONTHS+=("$(date -u -d "-${OFFSET} month" +%Y-%m 2>/dev/null || true)")
done
for MONTH in "${GEOIP_MONTHS[@]}"; do
    [ -z "$MONTH" ] && continue
    URL="https://download.db-ip.com/free/dbip-country-lite-${MONTH}.mmdb.gz"
    echo "  Trying: $URL"
    if wget -q --timeout=15 "$URL" -O /tmp/geoip.mmdb.gz 2>/dev/null; then
        gunzip -f /tmp/geoip.mmdb.gz
        mv /tmp/geoip.mmdb /usr/share/GeoIP/dbip-country-lite.mmdb
        chmod 644 /usr/share/GeoIP/dbip-country-lite.mmdb
        GEOIP_OK=1
        echo "  GeoIP DB installed ($MONTH)"
        break
    fi
done

if [ "$GEOIP_OK" = "0" ]; then
    echo "  GeoIP DB not downloaded -- geo-blocking disabled"
fi

# Controlla se il modulo geoip2 e' disponibile
HAS_GEOIP_MOD=0
if nginx -V 2>&1 | grep -q "geoip2" || [ -f /etc/nginx/modules-enabled/*geoip2* ] 2>/dev/null; then
    HAS_GEOIP_MOD=1
fi

# Installa config Nginx production
if [ "$SSL_OK" = "1" ]; then
    if [ "$GEOIP_OK" = "1" ] && [ "$HAS_GEOIP_MOD" = "1" ]; then
        # Full config: SSL + GeoIP.
        #
        # We generate /etc/nginx/conf.d/geoip2.conf directly (no template
        # substitution) because every template approach we tried had a
        # different quoting/escaping problem:
        #   - sed with multi-line replacement -> "unterminated s command"
        #   - awk -v with embedded \n         -> mawk (Ubuntu default) silently
        #                                        strips/flattens the newlines
        #                                        and nginx then sees lines like
        #                                        `CH 1;` outside any map{} block
        #                                        => "unknown directive CH".
        # Writing the file directly avoids all of that.
        {
            echo "# /etc/nginx/conf.d/geoip2.conf"
            echo "# Generated by full-deploy.sh from deploy.conf on $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
            echo ""
            echo "geoip2 /usr/share/GeoIP/dbip-country-lite.mmdb {"
            echo "    auto_reload 24h;"
            echo "    \$geoip2_data_country_code country iso_code;"
            echo "}"
            echo ""
            echo "# 1 = allowed country"
            echo "map \$geoip2_data_country_code \$geo_allowed {"
            echo "    default 0;"
            for CC in ${GEOIP_ALLOWED_COUNTRIES:-}; do
                echo "    ${CC}      1;"
            done
            echo "}"
            echo ""
            echo "# 1 = whitelisted IP (bypasses geo-block regardless of country)"
            echo "geo \$ip_whitelist {"
            echo "    default         0;"
            echo "    127.0.0.1/32    1;"
            echo "    ::1/128         1;"
            for IP in ${GEOIP_WHITELIST_IPS:-}; do
                echo "    ${IP} 1;"
            done
            echo "}"
            echo ""
            echo "# Final decision: block if country is NOT allowed AND IP is NOT whitelisted"
            echo "map \"\$geo_allowed:\$ip_whitelist\" \$geoip_block_access {"
            echo "    \"0:0\"   1;"
            echo "    default 0;"
            echo "}"
        } > /etc/nginx/conf.d/geoip2.conf

        # Single-line substitutions on the main server config stay on sed
        # (no newlines in the replacement values, so no escaping issues).
        sed -e "s|__DOMAIN__|${DOMAIN}|g" \
            -e "s|__APP_DIR__|${APP_DIR}|g" \
            -e "s|__PUBLIC_ORIGIN__|${PUBLIC_SITE_ORIGIN:-https://example.com}|g" \
            deploy/nginx-production.conf > /etc/nginx/sites-available/arkmaniagest
        echo "  Config: SSL + GeoIP + IP whitelist"
    else
        # SSL senza GeoIP -- creo config a mano
        echo "  GeoIP module not available, generating SSL config without geo-blocking"
        cat > /etc/nginx/sites-available/arkmaniagest << NGINX_SSL
limit_req_zone \$binary_remote_addr zone=api:10m rate=30r/s;
limit_req_zone \$binary_remote_addr zone=auth:10m rate=3r/s;

server {
    listen 80;
    server_name ${DOMAIN};
    server_tokens off;
    location /.well-known/acme-challenge/ { root /var/www/certbot; allow all; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};
    server_tokens off;

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 valid=300s;

    client_max_body_size 10M;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;

    location / {
        root ${APP_DIR}/frontend/dist;
        try_files \$uri \$uri/ /index.html;
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }
    location /api/ {
        limit_req zone=api burst=50 nodelay;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
        proxy_buffering off;
    }
    location ~ ^/api/v1/(auth/login|settings/setup) {
        limit_req zone=auth burst=5 nodelay;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location /health { proxy_pass http://127.0.0.1:8000; access_log off; }
    location ~ /\. { deny all; }
    location ~ \.(vault|env|key|pem|py|cjs|sh)$ { deny all; }
}
NGINX_SSL
    fi

    if nginx -t 2>&1; then
        systemctl reload nginx
        echo "  Nginx production RUNNING"
    else
        echo "  Nginx error! Restoring HTTP config..."
        cp deploy/nginx-initial.conf /etc/nginx/sites-available/arkmaniagest
        rm -f /etc/nginx/conf.d/geoip2.conf
        nginx -t && systemctl reload nginx
    fi
else
    echo "  Nessun SSL, Nginx resta in HTTP"
fi

# Cron update GeoIP mensile
cat > /etc/cron.monthly/update-geoip << 'GEOCRON'
#!/bin/bash
URL="https://download.db-ip.com/free/dbip-country-lite-$(date +%Y-%m).mmdb.gz"
wget -q --timeout=15 "$URL" -O /tmp/geoip.mmdb.gz 2>/dev/null && \
    gunzip -f /tmp/geoip.mmdb.gz && \
    mv /tmp/geoip.mmdb /usr/share/GeoIP/dbip-country-lite.mmdb && \
    chmod 644 /usr/share/GeoIP/dbip-country-lite.mmdb && \
    nginx -t 2>/dev/null && systemctl reload nginx
GEOCRON
chmod +x /etc/cron.monthly/update-geoip
echo "  PHASE 8 OK"
echo ""

# =============================================
# PHASE 9: FIREWALL + FAIL2BAN
# =============================================
echo "=== PHASE 9/9: Security ==="

# UFW
ufw --force reset >/dev/null 2>&1
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 'Nginx Full'
ufw --force enable
echo "  UFW attivo"

# Fail2ban
cp "$APP_DIR/deploy/fail2ban-jail.conf" /etc/fail2ban/jail.d/arkmaniagest.conf 2>/dev/null || true
cp "$APP_DIR/deploy/fail2ban-filter.conf" /etc/fail2ban/filter.d/arkmaniagest-vault.conf 2>/dev/null || true
systemctl enable fail2ban 2>/dev/null
systemctl restart fail2ban 2>/dev/null
echo "  Fail2ban attivo"

# Cron backup + health
cat > /etc/cron.d/arkmaniagest << 'CRONS'
# Daily backup (vault removed in v2.2.0 -- backs up .env + nginx config)
0 3 * * * root bash /opt/arkmaniagest/deploy/backup.sh >> /var/log/arkmaniagest/backup-cron.log 2>&1
# Health watchdog: restart backend if /health stops responding
*/5 * * * * root curl -sf http://127.0.0.1:8000/health >/dev/null 2>&1 || systemctl restart arkmaniagest
CRONS
echo "  Cron backup + health OK"

# Sudoers entry that lets the panel itself trigger the in-UI self-update
# (POST /system-update/install).  The snippet whitelists ONLY the literal
# server-update.sh path under bash, so even a panel compromise cannot
# escalate to arbitrary root code via this entry.
if [ -f "$APP_DIR/deploy/sudoers-arkmaniagest" ]; then
    install -m 0440 "$APP_DIR/deploy/sudoers-arkmaniagest" \
        /etc/sudoers.d/arkmaniagest
    if visudo -c -f /etc/sudoers.d/arkmaniagest >/dev/null 2>&1; then
        echo "  Self-update sudoers installed"
    else
        rm -f /etc/sudoers.d/arkmaniagest
        echo "  WARNING: sudoers snippet failed visudo -c -- removed"
    fi
fi

echo "  PHASE 9 OK"
echo ""

# =============================================
# VERIFICHE
# =============================================
echo "================================================"
echo "  VERIFICHE FINALI"
echo "================================================"

check() {
    printf "  %-16s" "$1:"
    if eval "$2" 2>/dev/null; then
        echo "OK"
    else
        echo "ERROR"
    fi
}

check "Backend" "systemctl is-active --quiet arkmaniagest"
check "Nginx" "systemctl is-active --quiet nginx"
check "UFW" "ufw status | grep -q active"
check "Fail2ban" "systemctl is-active --quiet fail2ban"
check "Health API" "curl -sf http://127.0.0.1:8000/health >/dev/null"
check "Frontend dist" "[ -d $APP_DIR/frontend/dist/assets ]"
check "SSL cert" "[ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]"
check "GeoIP DB" "[ -f /usr/share/GeoIP/dbip-country-lite.mmdb ]"

echo ""
echo "================================================"
echo "  DEPLOY COMPLETATO"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "  URL: https://${DOMAIN}"
echo "  Log: cat $LOG"
echo "================================================"
echo ""

# Marker di completamento
echo "DEPLOY_COMPLETE $(date '+%Y-%m-%d %H:%M:%S')" > /tmp/arkmaniagest-deploy-status
