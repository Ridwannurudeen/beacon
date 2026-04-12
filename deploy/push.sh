#!/usr/bin/env bash
# Local → VPS push. Run on the developer machine.
# Pushes the repo state and triggers remote rebuild.
#
# Usage: bash deploy/push.sh
#   Assumes VPS is configured in your ssh config as 'beacon-vps' or override below.
set -euo pipefail

VPS="${BEACON_VPS:-root@75.119.153.252}"
REMOTE_ROOT="/opt/beacon"

echo "==> push git to origin/main"
git push origin main

echo "==> trigger remote deploy"
ssh "${VPS}" "bash ${REMOTE_ROOT}/deploy/deploy.sh"
