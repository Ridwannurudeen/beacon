#!/usr/bin/env node
/**
 * VPS-side variant: writes atlas.json directly to the local filesystem instead
 * of SSHing into ourselves. Same on-chain reads as build-atlas-registry.mjs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, parseAbi, parseAbiItem } from "viem";

const ROOT = resolve(process.cwd());
const atlas = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/xlayerTestnet.atlas.json"), "utf-8"));
const beacon = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/xlayerTestnet.json"), "utf-8"));
const OUT = resolve(ROOT, "app/dist/atlas.json");

const rpc = createPublicClient({ transport: http("https://testrpc.xlayer.tech") });

const VAULT_ABI = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function pricePerShare() view returns (uint256)",
  "function agentEquity(address) view returns (uint256)",
]);
const REGISTRY_ABI = parseAbi([
  "function totalAgents() view returns (uint256)",
  "function agentIds(uint256) view returns (bytes32)",
  "function agents(bytes32) view returns (address wallet, string name, string strategy, uint256 startingCapital, uint64 registeredAt, uint256 tradeCount, uint256 signalCount, uint256 cumulativeSignalSpend, int256 cumulativePnL)",
]);
const AMM_ABI = parseAbi([
  "function spotPriceBInA() view returns (uint256)",
]);
const SIGNAL_CONSUMED = parseAbiItem(
  "event SignalConsumed(bytes32 indexed agentId, string signalSlug, uint256 cost, bytes32 settlementTx)"
);
const CALL_RECORDED = parseAbiItem(
  "event CallRecorded(bytes32 indexed signalId, address indexed payer, uint256 amount, bytes32 indexed settlement)"
);

const [tvl, totalSupply, pricePerShare, totalAgents, spot, head] = await Promise.all([
  rpc.readContract({ address: atlas.contracts.AtlasVault, abi: VAULT_ABI, functionName: "totalAssets" }),
  rpc.readContract({ address: atlas.contracts.AtlasVault, abi: VAULT_ABI, functionName: "totalSupply" }),
  rpc.readContract({ address: atlas.contracts.AtlasVault, abi: VAULT_ABI, functionName: "pricePerShare" }),
  rpc.readContract({ address: atlas.contracts.AgentRegistry, abi: REGISTRY_ABI, functionName: "totalAgents" }),
  rpc.readContract({ address: atlas.contracts.DemoAMM, abi: AMM_ABI, functionName: "spotPriceBInA" }),
  rpc.getBlockNumber(),
]);

const agentEntries = [];
const idToName = new Map();
let totalTrades = 0, totalSignals = 0;
let totalCascade = 0n;

for (let i = 0n; i < totalAgents; i++) {
  const id = await rpc.readContract({
    address: atlas.contracts.AgentRegistry, abi: REGISTRY_ABI, functionName: "agentIds", args: [i],
  });
  const a = await rpc.readContract({
    address: atlas.contracts.AgentRegistry, abi: REGISTRY_ABI, functionName: "agents", args: [id],
  });
  const equity = await rpc.readContract({
    address: atlas.contracts.AtlasVault, abi: VAULT_ABI, functionName: "agentEquity", args: [a[0]],
  });
  const starting = a[3];
  const pnlAbs = equity - starting;
  const pnlPct = starting === 0n ? 0 : Number((pnlAbs * 10000n) / starting) / 100;
  totalTrades += Number(a[5]);
  totalSignals += Number(a[6]);
  totalCascade += a[7];
  idToName.set(id, a[1]);
  agentEntries.push({
    id, address: a[0], name: a[1], strategy: a[2],
    startingCapital: starting.toString(),
    equity: equity.toString(),
    pnlAbs: pnlAbs.toString(),
    pnlPct,
    tradeCount: Number(a[5]),
    signalCount: Number(a[6]),
    cascadeSpend: a[7].toString(),
  });
}

const TOTAL_LOOKBACK = 900n;
const CHUNK = 100n;
const startBlock = head > TOTAL_LOOKBACK ? head - TOTAL_LOOKBACK : 0n;
async function pagedLogs(address, event) {
  const all = [];
  for (let from = startBlock; from <= head; from += CHUNK) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    try {
      const logs = await rpc.getLogs({ address, event, fromBlock: from, toBlock: to });
      all.push(...logs);
    } catch (e) {}
  }
  return all;
}
const [signalConsumedLogs, callRecordedLogs] = await Promise.all([
  pagedLogs(atlas.contracts.AgentRegistry, SIGNAL_CONSUMED),
  pagedLogs(beacon.contracts.SignalRegistry, CALL_RECORDED),
]);

const cascadeEvents = signalConsumedLogs
  .slice(-30)
  .reverse()
  .map((log) => ({
    block: Number(log.blockNumber),
    agent: idToName.get(log.args.agentId) ?? log.args.agentId.slice(0, 10),
    signalSlug: log.args.signalSlug,
    cost: log.args.cost.toString(),
    settlementTx: log.args.settlementTx,
    txHash: log.transactionHash,
  }));
const upstreamPayments = callRecordedLogs.slice(-60).reverse().map((log) => ({
  block: Number(log.blockNumber),
  signalId: log.args.signalId,
  payer: log.args.payer,
  amount: log.args.amount.toString(),
  settlement: log.args.settlement,
  txHash: log.transactionHash,
}));

const out = {
  chain: { id: 1952, name: "X Layer Testnet", explorer: "https://www.oklink.com/xlayer-test" },
  contracts: {
    ...atlas.contracts,
    SignalRegistry: beacon.contracts.SignalRegistry,
    PaymentSplitter: beacon.contracts.PaymentSplitter,
  },
  vault: { tvl: tvl.toString(), totalSupply: totalSupply.toString(), pricePerShare: pricePerShare.toString() },
  amm: { spotXInBUSD: spot.toString() },
  agents: agentEntries,
  totals: {
    trades: totalTrades, signals: totalSignals,
    cascadeSpend: totalCascade.toString(),
    cascadeEvents: cascadeEvents.length,
    upstreamPayments: upstreamPayments.length,
  },
  cascade: cascadeEvents,
  upstreamPayments,
  updatedAt: new Date().toISOString(),
};

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`✓ atlas.json (${agentEntries.length} agents, TVL ${Number(tvl) / 1e6}, ${cascadeEvents.length} cascade events)`);
