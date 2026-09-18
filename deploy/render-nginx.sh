#!/usr/bin/env bash
#
# render-nginx.sh -- re-render the panel vhost on an already-installed host.
#
# Neither update path touches /etc/nginx/sites-available/arkmaniagest:
# full-deploy.sh writes it at install time, and server-update.sh only reloads
# nginx.  So an nginx change that ships in a release (a proxy timeout, a
# header, a status code) never reaches a live panel.  Run this after an
# update that changed deploy/nginx-production.conf.
#
# It takes DOMAIN and the public-CORS map from deploy.conf when that file is
# present (the same values full-deploy.sh used), and otherwise reads them back
# out of the vhost currently installed, so it is safe on a host whose
# deploy.conf was never copied over.  The new file is validated with
# `nginx -t` before it is kept: on failure the previous vhost is restored and
# nothing is reloaded.
#
# Usage (as root, on the panel host):
#   bash /opt/arkmaniagest/deploy/render-nginx.sh [APP_DIR]
#
set -euo pipefail

APP_DIR="${1:-/opt/arkmaniagest}"
# VHOST is overridable so the render can be exercised against a fixture.
VHOST="${VHOST:-/etc/nginx/sites-available/arkmaniagest}"
TEMPLATE="$APP_DIR/deploy/nginx-production.conf"

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
[ -f "$TEMPLATE" ] || { echo "Template not found: $TEMPLATE"; exit 1; }
[ -f "$VHOST" ] || { echo "No installed vhost at $VHOST -- use full-deploy.sh for a first install."; exit 1; }

# --- Values -----------------------------------------------------------------
# deploy.conf is the source of truth when the operator kept it on the host.
DOMAIN=""
PUBLIC_SITE_ORIGIN=""
if [ -f "$APP_DIR/deploy/deploy.conf" ]; then
    # shellcheck disable=SC1091
    . "$APP_DIR/deploy/deploy.conf"
fi

if [ -z "$DOMAIN" ]; then
    # First server_name in the installed vhost that is not the "_" catch-all.
    DOMAIN=$(awk '$1 == "server_name" { gsub(/;/, "", $2); if ($2 != "_") { print $2; exit } }' "$VHOST")
fi
[ -n "$DOMAIN" ] || { echo "Could not determine the domain (set DOMAIN in deploy.conf)."; exit 1; }

# The public-CORS map: rebuild it from deploy.conf, or carry over the entries
# already installed.  Every entry stays on one line so the sed replacement
# below is newline-free.
PUBLIC_CORS_MAP=""
if [ -n "$PUBLIC_SITE_ORIGIN" ]; then
    for _origin in $(echo "$PUBLIC_SITE_ORIGIN" | tr ',' ' '); do
        PUBLIC_CORS_MAP="${PUBLIC_CORS_MAP}\"${_origin}\" \"${_origin}\"; "
    done
else
    PUBLIC_CORS_MAP=$(
        sed -n '/map \$http_origin \$arkm_public_cors/,/^}/p' "$VHOST" \
            | grep -vE 'map \$http_origin|default ""|^\}' \
            | tr -d '\n' \
            | sed 's/^[[:space:]]*//'
    )
fi

# --- Render -----------------------------------------------------------------
NEW=$(mktemp /tmp/arkmaniagest-vhost.XXXXXX)
trap 'rm -f "$NEW"' EXIT
sed -e "s|__DOMAIN__|${DOMAIN}|g" \
    -e "s|__APP_DIR__|${APP_DIR}|g" \
    -e "s|__PUBLIC_ORIGIN_MAP__|${PUBLIC_CORS_MAP}|g" \
    "$TEMPLATE" > "$NEW"

if cmp -s "$NEW" "$VHOST"; then
    echo "vhost already matches the template (domain: $DOMAIN) -- nothing to do."
    exit 0
fi

BACKUP="${VHOST}.bak-$(date +%Y%m%d_%H%M%S)"
cp -p "$VHOST" "$BACKUP"
cat "$NEW" > "$VHOST"

if nginx -t 2>&1 | sed 's/^/  nginx: /'; then
    systemctl reload nginx
    echo "vhost updated (domain: $DOMAIN), nginx reloaded. Previous copy: $BACKUP"
else
    cat "$BACKUP" > "$VHOST"
    echo "nginx -t FAILED on the rendered vhost; restored $BACKUP and reloaded nothing." >&2
    exit 1
fi
