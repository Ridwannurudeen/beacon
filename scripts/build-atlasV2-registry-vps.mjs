#!/usr/bin/env node
/**
 * V2 registry builder — reads atlasV2 state + CascadeLedger events directly.
 * Writes app/dist/atlas.json consumed by the dashboard.
 *
 * No heuristic matching: every cascade row is derived from a
 * CascadeSettled event + its matching UpstreamPaid events (all emitted by
 * the same tx when the receipt is submitted).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, parseAbi, parseAbiItem } from "viem";

const ROOT = resolve(process.cwd());
const v2 = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/xlayerTestnet.atlasV2.json"), "utf-8"));
const tokenDep = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/xlayerTestnet.testtoken.json"), "utf-8"));
const OUT = resolve(ROOT, "app/dist/atlas.json");

const rpc = createPublicClient({ transport: http("https://testrpc.xlayer.tech") });

const VAULT_ABI = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function pricePerShare() view returns (uint256)",
  "function guardian() view returns (address)",
  "function paused() view returns (bool)",
  "function strategyList(uint256) view returns (address)",
  "function strategyCount() view returns (uint256)",
  "function strategies(address) view returns (bool registered, uint256 debtLimit, uint256 currentDebt, uint256 totalProfit, uint256 totalLoss)",
]);

const STRATEGY_ABI = parseAbi([
  "function name() view returns (string)",
  "function totalAssets() view returns (uint256)",
  "function totalDebt() view returns (uint256)",
  "function subWallet() view returns (address)",
  "function executor() view returns (address)",
]);

const AMM_ABI = parseAbi([
  "function spotPriceBInA() view returns (uint256)",
]);

const TWAP_ABI = parseAbi([
  "function twap30m() view returns (uint256)",
]);

const CASCADE_SETTLED = parseAbiItem(
  "event CascadeSettled(bytes32 indexed receiptId, address indexed composite, address indexed buyer, uint256 buyerAmount, address settlementToken, bytes32 buyerSettlementTx, uint256 timestamp)"
);
const UPSTREAM_PAID = parseAbiItem(
  "event UpstreamPaid(bytes32 indexed receiptId, uint256 indexed index, string slug, address indexed author, uint256 amount, bytes32 settlementTx)"
);

const strategyNames = { Fear: "momentum", Greed: "mean-reversion", Skeptic: "intelligence-driven" };

const [tvl, totalSupply, pricePerShare, head, paused, guardian, spot, twap] = await Promise.all([
  rpc.readContract({ address: v2.contracts.AtlasVaultV2, abi: VAULT_ABI, functionName: "totalAssets" }),
  rpc.readContract({ address: v2.contracts.AtlasVaultV2, abi: VAULT_ABI, functionName: "totalSupply" }),
  rpc.readContract({ address: v2.contracts.AtlasVaultV2, abi: VAULT_ABI, functionName: "pricePerShare" }),
  rpc.getBlockNumber(),
  rpc.readContract({ address: v2.contracts.AtlasVaultV2, abi: VAULT_ABI, functionName: "paused" }),
  rpc.readContract({ address: v2.contracts.AtlasVaultV2, abi: VAULT_ABI, functionName: "guardian" }),
  rpc.readContract({ address: v2.contracts.DemoAMM, abi: AMM_ABI, functionName: "spotPriceBInA" }),
  (async () => {
    try {
      return await rpc.readContract({
        address: v2.contracts.TwapOracle,
        abi: TWAP_ABI,
        functionName: "twap30m",
      });
    } catch {
      return null;
    }
  })(),
]);

const strategies = [];
for (const key of ["Fear", "Greed", "Skeptic"]) {
  const addr = v2.contracts[key];
  if (!addr) continue;
  const [info, totalAssets, subW, execAddr] = await Promise.all([
    rpc.readContract({ address: v2.contracts.AtlasVaultV2, abi: VAULT_ABI, functionName: "strategies", args: [addr] }),
    rpc.readContract({ address: addr, abi: STRATEGY_ABI, functionName: "totalAssets" }),
    rpc.readContract({ address: addr, abi: STRATEGY_ABI, functionName: "subWallet" }),
    rpc.readContract({ address: addr, abi: STRATEGY_ABI, functionName: "executor" }),
  ]);
  const currentDebt = info[2];
  const equity = totalAssets;
  const pnlAbs = equity - currentDebt;
  const pnlPct = currentDebt === 0n ? 0 : Number((pnlAbs * 10000n) / currentDebt) / 100;
  strategies.push({
    address: addr,
    name: key,
    strategy: strategyNames[key] ?? "—",
    subWallet: subW,
    executor: execAddr,
    debtLimit: info[1].toString(),
    currentDebt: currentDebt.toString(),
    equity: equity.toString(),
    pnlAbs: pnlAbs.toString(),
    pnlPct,
    cumulativeProfit: info[3].toString(),
    cumulativeLoss: info[4].toString(),
  });
}

// --- Cascade events from CascadeLedger ---
const LOOKBACK = 10_000n;
const CHUNK = 100n;
const fromBlock = head > LOOKBACK ? head - LOOKBACK : 0n;

async function pagedLogs(address, event) {
  const all = [];
  for (let from = fromBlock; from <= head; from += CHUNK) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    try {
      const logs = await rpc.getLogs({ address, event, fromBlock: from, toBlock: to });
      all.push(...logs);
    } catch (e) {
      // RPC hiccups — skip and continue
    }
  }
  return all;
}

const [settledLogs, upstreamLogs] = await Promise.all([
  pagedLogs(v2.contracts.CascadeLedger, CASCADE_SETTLED),
  pagedLogs(v2.contracts.CascadeLedger, UPSTREAM_PAID),
]);

const upstreamByReceipt = new Map();
for (const log of upstreamLogs) {
  const id = log.args.receiptId;
  if (!upstreamByReceipt.has(id)) upstreamByReceipt.set(id, []);
  upstreamByReceipt.get(id).push({
    index: Number(log.args.index),
    slug: log.args.slug,
    author: log.args.author,
    amount: log.args.amount.toString(),
    settlementTx: log.args.settlementTx,
    txHash: log.transactionHash,
  });
}

const cascade = settledLogs
  .slice(-30)
  .reverse()
  .map((log) => {
    const ups = (upstreamByReceipt.get(log.args.receiptId) ?? []).sort((a, b) => a.index - b.index);
    return {
      receiptId: log.args.receiptId,
      composite: log.args.composite,
      buyer: log.args.buyer,
      buyerAmount: log.args.buyerAmount.toString(),
      settlementToken: log.args.settlementToken,
      buyerSettlementTx: log.args.buyerSettlementTx,
      timestamp: log.args.timestamp.toString(),
      block: Number(log.blockNumber),
      anchorTx: log.transactionHash,
      upstreams: ups,
    };
  });

const out = {
  version: "v2",
  chain: { id: 1952, name: "X Layer Testnet", explorer: "https://www.oklink.com/xlayer-test" },
  contracts: v2.contracts,
  beacon: v2.beacon ?? {},
  vault: {
    tvl: tvl.toString(),
    totalSupply: totalSupply.toString(),
    pricePerShare: pricePerShare.toString(),
    paused,
    guardian,
  },
  amm: {
    spotXInBUSD: spot.toString(),
    twap30m: twap ? twap.toString() : spot.toString(),
  },
  strategies,
  totals: {
    strategies: strategies.length,
    cascadeEvents: cascade.length,
    totalUpstreamPayments: cascade.reduce((a, c) => a + c.upstreams.length, 0),
  },
  cascade,
  token: tokenDep.token,
  updatedAt: new Date().toISOString(),
};

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`✓ atlas.json (V2) — TVL ${Number(tvl) / 1e6}, ${strategies.length} strategies, ${cascade.length} cascade receipts, ${out.totals.totalUpstreamPayments} upstream payments`);
