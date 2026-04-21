#!/usr/bin/env bash
# ============================================
# ArkManiaGest — Setup SSL with Let's Encrypt
# Usage: sudo bash setup-ssl.sh [domain]
# If no domain is passed, reads from deploy.conf
# ============================================
set -euo pipefail

# Source shared configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/deploy.conf" ]; then
    source "${SCRIPT_DIR}/deploy.conf"
fi

DOMAIN="${1:-${DOMAIN:-}}"
EMAIL="${SSL_EMAIL:-admin@example.com}"

if [ -z "$DOMAIN" ]; then
    echo "Usage: sudo bash setup-ssl.sh <domain>"
    echo "  Or set DOMAIN in deploy.conf"
    exit 1
fi

echo "============================================"
echo "  Setup SSL for: $DOMAIN"
echo "============================================"

# Update nginx config with the domain
sed -i "s/server_name _;/server_name $DOMAIN;/" /etc/nginx/sites-available/arkmaniagest
nginx -t && systemctl reload nginx

# Request certificate
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "$EMAIL" --redirect

# Restart backend to pick up any .env changes
systemctl restart arkmaniagest

echo ""
echo "  SSL configured for https://$DOMAIN"
echo "  Certbot auto-renewal: active"
echo ""
