#!/usr/bin/env node
/**
 * Builds atlas.json from on-chain reads and pushes to the VPS.
 * Reads:
 *   - AtlasVault.totalAssets / totalSupply / pricePerShare
 *   - AgentRegistry agent list + per-agent metrics
 *   - DemoAMM spot price
 *   - bUSD/MOCK-X balances per agent (for live equity)
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createPublicClient, http, parseAbi } from "viem";

const atlas = JSON.parse(readFileSync("contracts/deployments/xlayerTestnet.atlas.json", "utf-8"));
const VPS = process.env.BEACON_VPS ?? "root@75.119.153.252";

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

const [tvl, totalSupply, pricePerShare, totalAgents, spot] = await Promise.all([
  rpc.readContract({ address: atlas.contracts.AtlasVault, abi: VAULT_ABI, functionName: "totalAssets" }),
  rpc.readContract({ address: atlas.contracts.AtlasVault, abi: VAULT_ABI, functionName: "totalSupply" }),
  rpc.readContract({ address: atlas.contracts.AtlasVault, abi: VAULT_ABI, functionName: "pricePerShare" }),
  rpc.readContract({ address: atlas.contracts.AgentRegistry, abi: REGISTRY_ABI, functionName: "totalAgents" }),
  rpc.readContract({ address: atlas.contracts.DemoAMM, abi: AMM_ABI, functionName: "spotPriceBInA" }),
]);

const agentEntries = [];
let totalTrades = 0;
let totalSignals = 0;
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
  agentEntries.push({
    id,
    address: a[0],
    name: a[1],
    strategy: a[2],
    startingCapital: starting.toString(),
    equity: equity.toString(),
    pnlAbs: pnlAbs.toString(),
    pnlPct,
    tradeCount: Number(a[5]),
    signalCount: Number(a[6]),
    cascadeSpend: a[7].toString(),
  });
}

const out = {
  chain: { id: 1952, name: "X Layer Testnet", explorer: "https://www.oklink.com/xlayer-test" },
  contracts: atlas.contracts,
  vault: {
    tvl: tvl.toString(),
    totalSupply: totalSupply.toString(),
    pricePerShare: pricePerShare.toString(),
  },
  amm: { spotXInBUSD: spot.toString() },
  agents: agentEntries,
  totals: {
    trades: totalTrades,
    signals: totalSignals,
    cascadeSpend: totalCascade.toString(),
  },
  updatedAt: new Date().toISOString(),
};

const json = JSON.stringify(out, null, 2);
execSync(`ssh ${VPS} "cat > /opt/beacon/app/dist/atlas.json"`, { input: json });
console.log(`✓ atlas.json pushed (${agentEntries.length} agents, TVL ${Number(tvl) / 1e6} bUSD)`);
console.log(`  trades: ${totalTrades}, signals: ${totalSignals}, cascade: ${Number(totalCascade) / 1e6} bUSD`);
