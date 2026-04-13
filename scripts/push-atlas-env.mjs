#!/usr/bin/env node
/**
 * Pushes the agent-runner .env to the VPS (Atlas keys + signal URLs).
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const keys = JSON.parse(readFileSync(".keys/atlas-keys.json", "utf-8"));
const VPS = process.env.BEACON_VPS ?? "root@75.119.153.252";

const env = `FEAR_PRIVATE_KEY=${keys.fear.privateKey}
GREED_PRIVATE_KEY=${keys.greed.privateKey}
SKEPTIC_PRIVATE_KEY=${keys.skeptic.privateKey}
TICK_MS=30000
XLAYER_TESTNET_RPC=https://testrpc.xlayer.tech
DEPLOY_DIR=/opt/beacon/contracts/deployments
WALLET_RISK_URL=https://wallet-risk.gudman.xyz/signal
LIQUIDITY_DEPTH_URL=https://liquidity-depth.gudman.xyz/signal
YIELD_SCORE_URL=https://yield-score.gudman.xyz/signal
SAFE_YIELD_URL=https://safe-yield.gudman.xyz/signal
`;

execSync(`ssh ${VPS} "cat > /opt/beacon/atlas/agent-runner/.env"`, { input: env });
console.log("✓ atlas/agent-runner/.env pushed to VPS");
