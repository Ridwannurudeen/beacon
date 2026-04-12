#!/usr/bin/env bash
# Beacon VPS — deploy/redeploy. Runs on VPS after code push.
# Usage: bash /opt/beacon/deploy/deploy.sh [<service1> <service2> ...]
#   No args → rebuild + restart everything.
set -euo pipefail

ROOT="/opt/beacon"
cd "${ROOT}"

echo "==> pull latest"
git fetch --all
git reset --hard origin/main

echo "==> install + build workspaces"
npm install --no-audit --no-fund
(cd packages/sdk && npx tsc -p tsconfig.json)
(cd packages/mcp && npx tsc -p tsconfig.json)
(cd signals/wallet-risk && npx tsc -p tsconfig.json)
(cd signals/liquidity-depth && npx tsc -p tsconfig.json)
(cd signals/yield-score && npx tsc -p tsconfig.json)
(cd signals/safe-yield && npx tsc -p tsconfig.json)
(cd app && npx vite build)

echo "==> copy app/dist to served location (nginx reads /opt/beacon/app/dist)"
# Built in place — no copy needed, nginx root points at /opt/beacon/app/dist

SERVICES=("$@")
if [ ${#SERVICES[@]} -eq 0 ]; then
    SERVICES=(beacon-wallet-risk beacon-liquidity-depth beacon-yield-score beacon-safe-yield beacon-mcp)
fi

echo "==> restart services: ${SERVICES[*]}"
for svc in "${SERVICES[@]}"; do
    systemctl restart "${svc}"
    echo "  ${svc}: $(systemctl is-active ${svc})"
done

echo "==> reload nginx"
nginx -t && systemctl reload nginx

echo "✓ deploy complete"
systemctl --no-pager --lines=5 status beacon-wallet-risk beacon-liquidity-depth beacon-yield-score beacon-safe-yield beacon-mcp || true
