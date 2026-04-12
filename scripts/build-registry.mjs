#!/usr/bin/env node
/**
 * Builds a registry.json that the landing page ingests — reads signal /meta
 * endpoints + on-chain SignalRegistry counters for live metrics. Pushes to
 * /opt/beacon/app/dist/registry.json on the VPS.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createPublicClient, http, keccak256, encodePacked, parseAbi } from "viem";

const keys = JSON.parse(readFileSync(".keys/operator-keys.json", "utf-8"));
const deployment = JSON.parse(
  readFileSync("contracts/deployments/xlayerTestnet.json", "utf-8")
);
const testToken = JSON.parse(
  readFileSync("contracts/deployments/xlayerTestnet.testtoken.json", "utf-8")
);

const REGISTRY_ADDR = deployment.contracts.SignalRegistry;
const DEPLOYER = keys.deployer.address;
const VPS = process.env.BEACON_VPS ?? "root@75.119.153.252";

const rpc = createPublicClient({ transport: http("https://testrpc.xlayer.tech") });
const REGISTRY_ABI = parseAbi([
  "function signals(bytes32) view returns (address author, string slug, string url, uint256 price, uint64 registeredAt, bool retired, uint256 callCount, uint256 cumulativeRevenue)",
  "function totalSignals() view returns (uint256)",
]);

async function readSignal(slug) {
  const signalId = keccak256(encodePacked(["address", "string"], [DEPLOYER, slug]));
  const s = await rpc.readContract({
    address: REGISTRY_ADDR,
    abi: REGISTRY_ABI,
    functionName: "signals",
    args: [signalId],
  });
  return {
    author: s[0],
    slug: s[1],
    url: s[2],
    price: s[3].toString(),
    callCount: Number(s[6]),
    cumulativeRevenue: s[7].toString(),
  };
}

const slugs = ["wallet-risk", "liquidity-depth", "yield-score", "safe-yield"];
const upstream = { "safe-yield": ["wallet-risk", "liquidity-depth", "yield-score"] };

const signals = await Promise.all(
  slugs.map(async (slug) => {
    const on = await readSignal(slug);
    return {
      slug,
      description:
        slug === "wallet-risk"
          ? "Risk-scores an EVM wallet on X Layer via on-chain activity, bytecode, sanctions proximity."
          : slug === "liquidity-depth"
            ? "Reads Uniswap v3 pool liquidity, sqrt price, tick, and reserves on X Layer."
            : slug === "yield-score"
              ? "Normalized APY across X Layer lending venues for a given asset."
              : "Composite: safety-adjusted yield recommendation. Cascades x402 payments to three upstream signals.",
      url: on.url,
      author: on.author,
      price: on.price,
      token: testToken.token.symbol,
      isComposite: slug === "safe-yield",
      upstream: upstream[slug],
      callCount: on.callCount,
      cumulativeRevenueBaseUnits: on.cumulativeRevenue,
    };
  })
);

const totals = {
  signalsPublished: signals.length,
  composites: signals.filter((s) => s.isComposite).length,
  callsSettled: signals.reduce((a, s) => a + s.callCount, 0),
  volumeBaseUnits: signals
    .reduce((a, s) => a + BigInt(s.cumulativeRevenueBaseUnits), 0n)
    .toString(),
};

const out = {
  chain: { id: 1952, name: "X Layer Testnet", explorer: "https://www.oklink.com/xlayer-test" },
  contracts: {
    SignalRegistry: REGISTRY_ADDR,
    PaymentSplitter: deployment.contracts.PaymentSplitter,
    TestToken: testToken.token.address,
  },
  token: testToken.token,
  signals,
  metrics: totals,
  updatedAt: new Date().toISOString(),
};

const json = JSON.stringify(out, null, 2);
execSync(`ssh ${VPS} "cat > /opt/beacon/app/dist/registry.json"`, { input: json });
console.log(`✓ pushed registry.json to VPS (${signals.length} signals, ${totals.callsSettled} calls)`);
console.log(JSON.stringify(totals, null, 2));
