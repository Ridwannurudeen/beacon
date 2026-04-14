#!/usr/bin/env node
/**
 * Atlas V2 agent-runner. Submits signed intents to on-chain TradingStrategy
 * contracts + (for Skeptic) buys Beacon signals via x402 and anchors the
 * signed CascadeReceipts to CascadeLedger. Executors have zero custody.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as dotenv from "dotenv";
import type { Address } from "viem";
import type { SettlementToken } from "@beacon/sdk";
import { AgentRunnerV2 } from "./runnerV2.js";
import { MarketMover } from "./market-mover.js";
import { fear } from "./strategies/fear.js";
import { greed } from "./strategies/greed.js";
import { skeptic } from "./strategies/skeptic.js";

dotenv.config();

const TICK_MS = Number(process.env.TICK_MS ?? 30_000);
const RPC_URL = process.env.XLAYER_TESTNET_RPC ?? "https://testrpc.xlayer.tech";
const DEPLOY_DIR = process.env.DEPLOY_DIR ?? resolve(process.cwd(), "../../contracts/deployments");

const v2 = JSON.parse(readFileSync(resolve(DEPLOY_DIR, "xlayerTestnet.atlasV2.json"), "utf-8"));
const tokenDep = JSON.parse(
  readFileSync(resolve(DEPLOY_DIR, "xlayerTestnet.testtoken.json"), "utf-8")
);

const EXECUTOR_FEAR = process.env.FEAR_PRIVATE_KEY as `0x${string}` | undefined;
const EXECUTOR_GREED = process.env.GREED_PRIVATE_KEY as `0x${string}` | undefined;
const EXECUTOR_SKEPTIC = process.env.SKEPTIC_PRIVATE_KEY as `0x${string}` | undefined;
const MOVER_KEY = process.env.MOVER_PRIVATE_KEY as `0x${string}` | undefined;

if (!EXECUTOR_FEAR || !EXECUTOR_GREED || !EXECUTOR_SKEPTIC || !MOVER_KEY) {
  throw new Error("FEAR/GREED/SKEPTIC/MOVER_PRIVATE_KEY required");
}

const bUSD = v2.contracts.bUSD as Address;
const mockX = v2.contracts.MockX as Address;
const amm = v2.contracts.DemoAMM as Address;
const ledger = v2.contracts.CascadeLedger as Address;
const SAFE_YIELD_URL = process.env.SAFE_YIELD_URL ?? "https://safe-yield.gudman.xyz/signal";

const busdToken: SettlementToken = {
  address: tokenDep.token.address,
  symbol: tokenDep.token.symbol,
  decimals: tokenDep.token.decimals,
  eip712Name: tokenDep.token.name,
  eip712Version: tokenDep.token.version,
};

const runners = [
  new AgentRunnerV2(
    {
      executorPrivateKey: EXECUTOR_FEAR,
      strategy: v2.contracts.Fear as Address,
      asset: bUSD,
      other: mockX,
      amm,
      cascadeLedger: ledger,
      rpcUrl: RPC_URL,
      consumesSignals: false,
    },
    fear
  ),
  new AgentRunnerV2(
    {
      executorPrivateKey: EXECUTOR_GREED,
      strategy: v2.contracts.Greed as Address,
      asset: bUSD,
      other: mockX,
      amm,
      cascadeLedger: ledger,
      rpcUrl: RPC_URL,
      consumesSignals: false,
    },
    greed
  ),
  new AgentRunnerV2(
    {
      executorPrivateKey: EXECUTOR_SKEPTIC,
      strategy: v2.contracts.Skeptic as Address,
      asset: bUSD,
      other: mockX,
      amm,
      cascadeLedger: ledger,
      rpcUrl: RPC_URL,
      signalUrl: SAFE_YIELD_URL,
      busdToken,
      signalPrice: 6000n,
      demoAsset: bUSD,
      consumesSignals: true,
      chainId: 1952,
    },
    skeptic
  ),
];

const mover = new MarketMover({
  privateKey: MOVER_KEY,
  bUSD,
  mockX,
  amm,
  rpcUrl: RPC_URL,
  minSize: 1500n * 10n ** 6n,
  maxSize: 4000n * 10n ** 6n,
});

async function main() {
  console.log(`Atlas V2 agent-runner started`);
  console.log(`  Vault:         ${v2.contracts.AtlasVaultV2}`);
  console.log(`  Fear:          ${v2.contracts.Fear}`);
  console.log(`  Greed:         ${v2.contracts.Greed}`);
  console.log(`  Skeptic:       ${v2.contracts.Skeptic}  (x402 signal consumer)`);
  console.log(`  CascadeLedger: ${ledger}`);
  console.log(`  signal URL:    ${SAFE_YIELD_URL}`);
  console.log(`  mover:         ${mover.address}`);

  for (const r of runners) {
    await r.init();
    console.log(`  ${r.address} → strategy`);
  }

  let tickCount = 0;
  const tick = async () => {
    const t0 = Date.now();
    if (tickCount % 2 === 0) {
      try {
        const m = await mover.tick();
        console.log(`[mover] ${m.side} ${Number(m.size) / 1e6} → ${m.tx}`);
      } catch (e) {
        console.error(`mover: ${(e as Error).message}`);
      }
    }
    for (const r of runners) {
      try {
        await r.tick();
      } catch (e) {
        console.error(`tick: ${(e as Error).message}`);
      }
    }
    tickCount++;
    console.log(`--- v2 tick #${tickCount} complete in ${Date.now() - t0}ms ---`);
  };

  setTimeout(() => {
    tick();
    setInterval(tick, TICK_MS);
  }, 2000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
