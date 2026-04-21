#!/usr/bin/env bash
# ArkManiaGest — Status Check

# Source shared configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "${SCRIPT_DIR}/deploy.conf" ]; then
    source "${SCRIPT_DIR}/deploy.conf"
fi
DOMAIN="${DOMAIN:-localhost}"

echo "=== ArkManiaGest Status — $(date '+%Y-%m-%d %H:%M:%S') ==="
echo ""
for svc in arkmaniagest nginx fail2ban; do
    printf "  %-14s" "$svc:"
    systemctl is-active --quiet $svc && echo -e "\e[32mACTIVE\e[0m" || echo -e "\e[31mSTOPPED\e[0m"
done
printf "  %-14s" "UFW:"
ufw status 2>/dev/null | grep -q "active" && echo -e "\e[32mACTIVE\e[0m" || echo -e "\e[33mOFF\e[0m"
printf "  %-14s" "SSL:"
[ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] && echo -e "\e[32mOK\e[0m ($(openssl x509 -enddate -noout -in /etc/letsencrypt/live/$DOMAIN/fullchain.pem 2>/dev/null | cut -d= -f2))" || echo -e "\e[31mNO\e[0m"
printf "  %-14s" "GeoIP:"
[ -f "/usr/share/GeoIP/dbip-country-lite.mmdb" ] && echo -e "\e[32mOK\e[0m" || echo -e "\e[31mNO\e[0m"
printf "  %-14s" "Health:"
curl -sf http://127.0.0.1:8000/health >/dev/null && echo -e "\e[32mOK\e[0m" || echo -e "\e[31mERROR\e[0m"
echo ""
echo "  Backups: $(ls ${BACKUP_DIR:-/opt/arkmaniagest-backups}/*.tar.gz 2>/dev/null | wc -l)"
echo "  Logs size: $(du -sh ${LOG_DIR:-/var/log/arkmaniagest}/ 2>/dev/null | cut -f1)"
echo "  Disk: $(df -h ${APP_DIR:-/opt/arkmaniagest} 2>/dev/null | tail -1 | awk '{print $3"/"$2" ("$5")"}')"
echo ""
echo "  Fail2ban jails: $(fail2ban-client status 2>/dev/null | grep 'Number of jail' | awk '{print $NF}')"
echo ""
