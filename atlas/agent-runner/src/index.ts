#!/usr/bin/env node
/**
 * Atlas agent-runner: spins up three competing strategies (Fear, Greed, Skeptic)
 * and ticks them on a fixed interval. Each agent runs in its own loop with its
 * own wallet, books, and decision logic. They share an AMM and a registry.
 *
 * Designed to run as a single systemd unit on the VPS — one process, three
 * agents, one global tick. Restart-safe: state is rebuilt from on-chain reads.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as dotenv from "dotenv";
import type { Address } from "viem";
import type { SettlementToken } from "@beacon/sdk";
import { AgentRunner } from "./runner.js";
import { fear } from "./strategies/fear.js";
import { greed } from "./strategies/greed.js";
import { skeptic } from "./strategies/skeptic.js";

dotenv.config();

interface AtlasDeployment {
  network: string;
  chainId: number;
  contracts: {
    bUSD: Address;
    MockX: Address;
    AgentRegistry: Address;
    DemoAMM: Address;
    AtlasVault: Address;
  };
}

interface BUSDDeployment {
  token: { address: Address; name: string; version: string; symbol: string; decimals: number };
}

const TICK_MS = Number(process.env.TICK_MS ?? 30_000);
const RPC_URL = process.env.XLAYER_TESTNET_RPC ?? "https://testrpc.xlayer.tech";

const DEPLOY_DIR = process.env.DEPLOY_DIR ?? resolve(process.cwd(), "../../contracts/deployments");
const atlas: AtlasDeployment = JSON.parse(
  readFileSync(resolve(DEPLOY_DIR, "xlayerTestnet.atlas.json"), "utf-8")
);
const tokenDep: BUSDDeployment = JSON.parse(
  readFileSync(resolve(DEPLOY_DIR, "xlayerTestnet.testtoken.json"), "utf-8")
);

const busdToken: SettlementToken = {
  address: tokenDep.token.address,
  symbol: tokenDep.token.symbol,
  decimals: tokenDep.token.decimals,
  eip712Name: tokenDep.token.name,
  eip712Version: tokenDep.token.version,
};

const KEYS = {
  fear: process.env.FEAR_PRIVATE_KEY,
  greed: process.env.GREED_PRIVATE_KEY,
  skeptic: process.env.SKEPTIC_PRIVATE_KEY,
};
for (const [name, k] of Object.entries(KEYS)) {
  if (!k) throw new Error(`${name.toUpperCase()}_PRIVATE_KEY required in env`);
}

const SIGNAL_URLS = {
  "wallet-risk": process.env.WALLET_RISK_URL ?? "https://wallet-risk.gudman.xyz/signal",
  "liquidity-depth": process.env.LIQUIDITY_DEPTH_URL ?? "https://liquidity-depth.gudman.xyz/signal",
  "yield-score": process.env.YIELD_SCORE_URL ?? "https://yield-score.gudman.xyz/signal",
  "safe-yield": process.env.SAFE_YIELD_URL ?? "https://safe-yield.gudman.xyz/signal",
} as const;

const SIGNAL_PRICES = {
  "wallet-risk": 1000n,
  "liquidity-depth": 2000n,
  "yield-score": 1500n,
  "safe-yield": 6000n,
} as const;

const DEMO_ASSET = (process.env.DEMO_ASSET ?? atlas.contracts.bUSD) as Address;

const runners = [
  new AgentRunner(
    {
      privateKey: KEYS.fear as `0x${string}`,
      bUSD: atlas.contracts.bUSD,
      mockX: atlas.contracts.MockX,
      amm: atlas.contracts.DemoAMM,
      registry: atlas.contracts.AgentRegistry,
      busdToken,
      signalUrls: SIGNAL_URLS,
      signalPrices: SIGNAL_PRICES,
      rpcUrl: RPC_URL,
      demoAsset: DEMO_ASSET,
    },
    fear
  ),
  new AgentRunner(
    {
      privateKey: KEYS.greed as `0x${string}`,
      bUSD: atlas.contracts.bUSD,
      mockX: atlas.contracts.MockX,
      amm: atlas.contracts.DemoAMM,
      registry: atlas.contracts.AgentRegistry,
      busdToken,
      signalUrls: SIGNAL_URLS,
      signalPrices: SIGNAL_PRICES,
      rpcUrl: RPC_URL,
      demoAsset: DEMO_ASSET,
    },
    greed
  ),
  new AgentRunner(
    {
      privateKey: KEYS.skeptic as `0x${string}`,
      bUSD: atlas.contracts.bUSD,
      mockX: atlas.contracts.MockX,
      amm: atlas.contracts.DemoAMM,
      registry: atlas.contracts.AgentRegistry,
      busdToken,
      signalUrls: SIGNAL_URLS,
      signalPrices: SIGNAL_PRICES,
      rpcUrl: RPC_URL,
      demoAsset: DEMO_ASSET,
    },
    skeptic
  ),
];

console.log(`Atlas agent-runner started`);
console.log(`  AMM:      ${atlas.contracts.DemoAMM}`);
console.log(`  Registry: ${atlas.contracts.AgentRegistry}`);
console.log(`  Vault:    ${atlas.contracts.AtlasVault}`);
console.log(`  bUSD:     ${atlas.contracts.bUSD}`);
console.log(`  MockX:    ${atlas.contracts.MockX}`);
console.log(`  tick:     ${TICK_MS}ms`);
for (const r of runners) console.log(`  agent:    ${r.address}`);

async function tick() {
  const t0 = Date.now();
  // Run agents sequentially so the AMM state mutations are observable in order.
  for (const r of runners) {
    try {
      await r.tick();
    } catch (e) {
      console.error(`tick error: ${(e as Error).message}`);
    }
  }
  const dt = Date.now() - t0;
  console.log(`--- tick complete in ${dt}ms ---`);
}

async function main() {
  // Self-register each agent on the AgentRegistry (idempotent)
  for (const r of runners) {
    try {
      await r.ensureRegistered(
        r === runners[0] ? "momentum" : r === runners[1] ? "mean-reversion" : "intelligence-driven",
        10_000n * 10n ** 6n
      );
    } catch (e) {
      console.error(`registration failed for ${r.address}: ${(e as Error).message}`);
    }
  }
  // Initial tick after a small delay to let logs flush
  setTimeout(() => {
    tick();
    setInterval(tick, TICK_MS);
  }, 2000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
