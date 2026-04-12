#!/usr/bin/env node
/**
 * Builds .env contents for all signal servers + MCP from the local keys and
 * deployment artifacts, then pushes them to the VPS via SSH. DOES NOT commit
 * anything to git — the keys stay local.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const keys = JSON.parse(readFileSync(".keys/operator-keys.json", "utf-8"));
const deployment = JSON.parse(
  readFileSync("contracts/deployments/xlayerTestnet.json", "utf-8")
);
const testToken = JSON.parse(
  readFileSync("contracts/deployments/xlayerTestnet.testtoken.json", "utf-8")
);

const VPS = process.env.BEACON_VPS ?? "root@75.119.153.252";
const TOKEN = testToken.token;

const baseTokenEnv = `TOKEN_ADDRESS=${TOKEN.address}
TOKEN_NAME=${TOKEN.name}
TOKEN_VERSION=${TOKEN.version}
TOKEN_SYMBOL=${TOKEN.symbol}`;

const envs = {
  "signals/wallet-risk/.env": `CHAIN_ID=1952
SIGNAL_PRIVATE_KEY=${keys["wallet-risk"].privateKey}
PAY_TO=${keys["wallet-risk"].address}
PRICE=1000
PORT=4001
${baseTokenEnv}
`,
  "signals/liquidity-depth/.env": `CHAIN_ID=1952
SIGNAL_PRIVATE_KEY=${keys["liquidity-depth"].privateKey}
PAY_TO=${keys["liquidity-depth"].address}
PRICE=2000
PORT=4002
${baseTokenEnv}
UNISWAP_V3_FACTORY=
MOCK_FALLBACK=true
`,
  "signals/yield-score/.env": `CHAIN_ID=1952
SIGNAL_PRIVATE_KEY=${keys["yield-score"].privateKey}
PAY_TO=${keys["yield-score"].address}
PRICE=1500
PORT=4003
${baseTokenEnv}
AAVE_POOL_DATA_PROVIDER=
MOCK_FALLBACK=true
`,
  "signals/safe-yield/.env": `CHAIN_ID=1952
SIGNAL_PRIVATE_KEY=${keys["safe-yield"].privateKey}
PAYER_PRIVATE_KEY=${keys["safe-yield"].privateKey}
PAY_TO=${keys["safe-yield"].address}
PRICE=6000
PORT=4010
${baseTokenEnv}

WALLET_RISK_URL=https://wallet-risk.gudman.xyz/signal
LIQUIDITY_DEPTH_URL=https://liquidity-depth.gudman.xyz/signal
YIELD_SCORE_URL=https://yield-score.gudman.xyz/signal

WALLET_RISK_PRICE=1000
LIQUIDITY_DEPTH_PRICE=2000
YIELD_SCORE_PRICE=1500

WALLET_RISK_PAYTO=${keys["wallet-risk"].address}
LIQUIDITY_DEPTH_PAYTO=${keys["liquidity-depth"].address}
YIELD_SCORE_PAYTO=${keys["yield-score"].address}
`,
  "packages/mcp/.env": `AGENT_PRIVATE_KEY=${keys["deployer"].privateKey}
BEACON_REGISTRY_URL=https://beacon.gudman.xyz/registry.json
MCP_PORT=4100
`,
  "contracts/.env": `PRIVATE_KEY=${keys["deployer"].privateKey}
XLAYER_RPC=https://rpc.xlayer.tech
XLAYER_TESTNET_RPC=https://testrpc.xlayer.tech
`,
};

console.log(`Pushing ${Object.keys(envs).length} .env files to ${VPS}...`);
for (const [relPath, content] of Object.entries(envs)) {
  const remotePath = `/opt/beacon/${relPath}`;
  // Use stdin to avoid shell quoting issues with special chars in keys
  const result = execSync(
    `ssh ${VPS} "cat > ${remotePath}"`,
    { input: content, encoding: "utf-8" }
  );
  console.log(`  ${relPath}`);
  void result;
}
console.log("\n✓ env files pushed");

console.log("\nContract addresses:");
console.log(`  SignalRegistry:  ${deployment.contracts.SignalRegistry}`);
console.log(`  PaymentSplitter: ${deployment.contracts.PaymentSplitter}`);
console.log(`  TestToken:       ${TOKEN.address}`);
