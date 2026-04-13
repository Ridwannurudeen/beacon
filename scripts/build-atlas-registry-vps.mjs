#!/usr/bin/env node
/**
 * VPS-side: writes atlas.json directly to the local filesystem. Same on-chain
 * reads as build-atlas-registry.mjs but sourced from local files. Includes:
 *   - Vault TVL / NAV
 *   - Per-agent leaderboard
 *   - Cascade feed: each SignalConsumed enriched with the upstream
 *     AuthorizationUsed events emitted by bUSD that match the composite's
 *     fan-out (one Skeptic call → four settlements, all surfaced together).
 *   - Recent trades feed
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, parseAbi, parseAbiItem } from "viem";

const ROOT = resolve(process.cwd());
const atlas = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/xlayerTestnet.atlas.json"), "utf-8"));
const beacon = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/xlayerTestnet.json"), "utf-8"));
const tokenDep = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/xlayerTestnet.testtoken.json"), "utf-8"));
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
const AGENT_TRADED = parseAbiItem(
  "event AgentTraded(bytes32 indexed agentId, address indexed tokenIn, uint256 amountIn, address indexed tokenOut, uint256 amountOut, int256 pnlDelta, bytes32 txHash)"
);
const AUTH_USED = parseAbiItem(
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)"
);
const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
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
const addrToName = new Map();
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
  addrToName.set(a[0].toLowerCase(), a[1]);
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

const [signalConsumedLogs, agentTradedLogs, authUsedLogs] = await Promise.all([
  pagedLogs(atlas.contracts.AgentRegistry, SIGNAL_CONSUMED),
  pagedLogs(atlas.contracts.AgentRegistry, AGENT_TRADED),
  pagedLogs(tokenDep.token.address, AUTH_USED),
]);

// Group AuthorizationUsed events by tx hash to find cascades
const authsByTxHash = new Map();
for (const log of authUsedLogs) {
  if (!authsByTxHash.has(log.transactionHash)) authsByTxHash.set(log.transactionHash, []);
  authsByTxHash.get(log.transactionHash).push(log);
}

// Address → server name (which signal owns each EOA)
const SIGNAL_OPERATORS = {
  // wallet-risk PAY_TO from .keys/operator-keys.json
  "0x1e9921b1c6ca20511d9fc1adb344882c59002bd6": "wallet-risk",
  "0x75d51494005aa71e0170dce8086d7caec07b7906": "liquidity-depth",
  "0x20c7ad3561993fa5777bff6cd532697d1ca994b0": "yield-score",
  "0x7535ab44553fe7d0b11aa6ac8cbc432c81cb998d": "safe-yield",
};

// For each cascade event, find the upstream AuthorizationUsed events that
// followed it: the safe-yield server (after receiving Skeptic's payment) issues
// 3 transferWithAuthorization calls to the upstreams. They're in subsequent
// blocks, but all `authorizer` is `safe-yield` (sender of those payments).
const cascadeEvents = signalConsumedLogs
  .slice(-30)
  .reverse()
  .map((log) => {
    const args = log.args;
    const buyerName = idToName.get(args.agentId) ?? args.agentId.slice(0, 10);
    // Find all auths within ~10 blocks after this settlement that originated
    // from the safe-yield server (the composite forwarding to upstreams)
    const buyerSettlementBlock = Number(log.blockNumber);
    const upstreamAuths = authUsedLogs
      .filter((a) => {
        const blk = Number(a.blockNumber);
        return (
          blk >= buyerSettlementBlock &&
          blk <= buyerSettlementBlock + 15 &&
          a.args.authorizer.toLowerCase() === "0x7535ab44553fe7d0b11aa6ac8cbc432c81cb998d"
        );
      })
      .slice(0, 3)
      .map((a) => ({
        txHash: a.transactionHash,
        authorizer: a.args.authorizer,
        nonce: a.args.nonce,
        block: Number(a.blockNumber),
      }));
    return {
      block: buyerSettlementBlock,
      agent: buyerName,
      signalSlug: args.signalSlug,
      cost: args.cost.toString(),
      settlementTx: args.settlementTx,
      txHash: log.transactionHash,
      cascade: upstreamAuths,
    };
  });

const recentTrades = agentTradedLogs
  .slice(-50)
  .reverse()
  .map((log) => {
    const args = log.args;
    const agentName = idToName.get(args.agentId) ?? args.agentId.slice(0, 10);
    const isBuy = args.tokenIn.toLowerCase() === tokenDep.token.address.toLowerCase();
    return {
      block: Number(log.blockNumber),
      agent: agentName,
      side: isBuy ? "BUY" : "SELL",
      amountIn: args.amountIn.toString(),
      amountOut: args.amountOut.toString(),
      txHash: log.transactionHash,
    };
  });

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
    upstreamPayments: cascadeEvents.reduce((a, c) => a + c.cascade.length, 0),
  },
  cascade: cascadeEvents,
  recentTrades,
  updatedAt: new Date().toISOString(),
};

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`✓ atlas.json (${agentEntries.length} agents, TVL ${Number(tvl) / 1e6}, ${cascadeEvents.length} cascade events with ${out.totals.upstreamPayments} upstream payments, ${recentTrades.length} recent trades)`);
