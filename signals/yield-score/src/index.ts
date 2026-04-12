import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  http,
  isAddress,
  parseAbi,
  formatUnits,
  type Address,
} from "viem";
import {
  defineSignal,
  xLayer,
  xLayerTestnet,
  xLayerWalletClient,
  xLayerTestnetWalletClient,
  type SettlementToken,
} from "@beacon/sdk";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * yield-score — Beacon base signal. Reads Aave v3 PoolDataProvider on X Layer
 * (mainnet). On testnet falls back to a stable synthetic curve so the composite
 * cascade completes.
 */

const PRIVATE_KEY = (process.env.SIGNAL_PRIVATE_KEY ?? "") as `0x${string}`;
const PAY_TO = (process.env.PAY_TO ?? "") as Address;
const PORT = Number(process.env.PORT ?? 4003);
const PRICE = BigInt(process.env.PRICE ?? "1500");
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 1952);
const AAVE_POOL_DATA_PROVIDER = (process.env.AAVE_POOL_DATA_PROVIDER ?? "") as Address;
const MOCK_FALLBACK = process.env.MOCK_FALLBACK !== "false";

const TOKEN_ADDRESS = (process.env.TOKEN_ADDRESS ?? "") as `0x${string}`;
const TOKEN_NAME = process.env.TOKEN_NAME ?? "Beacon USD";
const TOKEN_VERSION = process.env.TOKEN_VERSION ?? "1";
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL ?? "bUSD";

if (!PRIVATE_KEY) throw new Error("SIGNAL_PRIVATE_KEY required");
if (!isAddress(PAY_TO)) throw new Error("PAY_TO required");
if (!isAddress(TOKEN_ADDRESS)) throw new Error("TOKEN_ADDRESS required");

const account = privateKeyToAccount(PRIVATE_KEY);
const isTestnet = CHAIN_ID === 1952;
const chain = isTestnet ? xLayerTestnet : xLayer;
const settlementWallet = isTestnet
  ? xLayerTestnetWalletClient(account)
  : xLayerWalletClient(account);
const publicClient = createPublicClient({ chain, transport: http() });

const token: SettlementToken = {
  address: TOKEN_ADDRESS,
  symbol: TOKEN_SYMBOL,
  decimals: 6,
  eip712Name: TOKEN_NAME,
  eip712Version: TOKEN_VERSION,
};

const AAVE_ABI = parseAbi([
  "function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
]);

const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31_536_000n;

function rayRateToApyPct(rayPerSecond: bigint): string {
  const scaled = (rayPerSecond * SECONDS_PER_YEAR * 10_000n) / RAY;
  const whole = scaled / 100n;
  const frac = scaled % 100n;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

interface YieldOutput {
  asset: Address;
  venues: Array<{
    venue: string;
    supplyApyPct: string;
    borrowApyPct: string;
    totalSupplied: string;
    totalBorrowed: string;
    utilizationPct: string;
  }>;
  bestSupply: { venue: string; apyPct: string } | null;
  blockNumber: string;
  source: "aave-v3" | "mock";
}

async function scoreYield(asset: Address): Promise<YieldOutput> {
  const venues: YieldOutput["venues"] = [];
  let source: YieldOutput["source"] = "mock";

  if (isAddress(AAVE_POOL_DATA_PROVIDER)) {
    try {
      const data = await publicClient.readContract({
        address: AAVE_POOL_DATA_PROVIDER, abi: AAVE_ABI,
        functionName: "getReserveData", args: [asset],
      });
      const [, , totalAToken, totalStable, totalVariable, liquidityRate, variableBorrowRate] = data;
      const totalSupplied = totalAToken;
      const totalBorrowed = totalStable + totalVariable;
      const utilization = totalSupplied === 0n ? 0n : (totalBorrowed * 10_000n) / totalSupplied;

      venues.push({
        venue: "aave-v3-xlayer",
        supplyApyPct: rayRateToApyPct(liquidityRate),
        borrowApyPct: rayRateToApyPct(variableBorrowRate),
        totalSupplied: formatUnits(totalSupplied, 18),
        totalBorrowed: formatUnits(totalBorrowed, 18),
        utilizationPct: `${utilization / 100n}.${(utilization % 100n).toString().padStart(2, "0")}`,
      });
      source = "aave-v3";
    } catch (e) {
      console.warn(`[yield-score] aave read failed: ${(e as Error).message}`);
    }
  }

  if (venues.length === 0 && MOCK_FALLBACK) {
    venues.push({
      venue: "mock-venue",
      supplyApyPct: "3.25",
      borrowApyPct: "5.80",
      totalSupplied: "1000000.00",
      totalBorrowed: "500000.00",
      utilizationPct: "50.00",
    });
  }

  const bestSupply = venues.slice().sort(
    (a, b) => Number(b.supplyApyPct) - Number(a.supplyApyPct)
  )[0];

  const block = await publicClient.getBlockNumber();
  return {
    asset, venues, source,
    bestSupply: bestSupply ? { venue: bestSupply.venue, apyPct: bestSupply.supplyApyPct } : null,
    blockNumber: block.toString(),
  };
}

const signal = defineSignal({
  slug: "yield-score",
  description: "Normalized APY across X Layer lending venues for a given asset. Query ?asset=0x...",
  price: PRICE,
  payTo: PAY_TO,
  token,
  chainId: CHAIN_ID,
  settlementWallet,
  handler: async (c) => {
    const asset = c.req.query("asset");
    if (!asset || !isAddress(asset)) throw new Error("valid ?asset=0x... required");
    return scoreYield(asset);
  },
  onSettled: ({ payer, amount, txHash }) => {
    console.log(`[yield-score] settled: payer=${payer} amount=${amount} tx=${txHash}`);
  },
});

const app = new Hono();
app.get("/", (c: Context) =>
  c.json({ service: "beacon:yield-score", endpoint: "/signal", meta: "/signal/meta" })
);
app.route("/signal", signal.app);

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`yield-score listening on :${info.port} (chain ${CHAIN_ID})`);
});
