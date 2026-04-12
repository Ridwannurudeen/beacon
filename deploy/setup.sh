#!/usr/bin/env bash
# Beacon VPS — initial server bootstrap. Run ONCE on 75.119.153.252 as root.
# Assumes nginx + certbot + node 20+ already present (per the existing VPS setup).
set -euo pipefail

DOMAIN_ROOT="gudman.xyz"
SUBDOMAINS=(beacon wallet-risk liquidity-depth yield-score safe-yield mcp)

echo "==> issue certificates via certbot webroot"
for sub in "${SUBDOMAINS[@]}"; do
    domain="${sub}.${DOMAIN_ROOT}"
    if [ -d "/etc/letsencrypt/live/${domain}" ]; then
        echo "  cert already exists for ${domain}"
    else
        certbot certonly -d "${domain}" -n --agree-tos --email "admin@${DOMAIN_ROOT}"
    fi
done

echo "==> install nginx configs"
cp /opt/beacon/deploy/nginx/beacon.gudman.xyz.conf /etc/nginx/sites-available/
cp /opt/beacon/deploy/nginx/beacon-signals.conf /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/beacon.gudman.xyz.conf /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/beacon-signals.conf /etc/nginx/sites-enabled/

echo "==> test + reload nginx"
nginx -t
systemctl reload nginx

echo "==> install systemd units"
cp /opt/beacon/deploy/systemd/*.service /etc/systemd/system/
systemctl daemon-reload

echo "==> enable services (will start after deploy)"
for svc in beacon-wallet-risk beacon-liquidity-depth beacon-yield-score beacon-safe-yield beacon-mcp; do
    systemctl enable "${svc}"
done

echo "==> open firewall (UFW)"
ufw allow 443/tcp || true
ufw allow 80/tcp || true

echo "✓ setup complete. Next: populate .env files in each signal dir, then run deploy.sh"
