import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { isAddress, type Address } from "viem";
import {
  defineComposite,
  xLayer,
  xLayerTestnet,
  xLayerWalletClient,
  xLayerTestnetWalletClient,
  type SettlementToken,
} from "@beacon/sdk";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * safe-yield — Beacon reference composite. Cascades x402 payments to three
 * upstreams on every call. One HTTP call to this service = four on-chain
 * settlements visible on OKLink.
 */

const PRIVATE_KEY = (process.env.SIGNAL_PRIVATE_KEY ?? "") as `0x${string}`;
const PAYER_PRIVATE_KEY = (process.env.PAYER_PRIVATE_KEY ?? PRIVATE_KEY) as `0x${string}`;
const PAY_TO = (process.env.PAY_TO ?? "") as Address;
const PORT = Number(process.env.PORT ?? 4010);
const PRICE = BigInt(process.env.PRICE ?? "6000");
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 1952);

const WALLET_RISK_URL = process.env.WALLET_RISK_URL ?? "http://localhost:4001/signal";
const LIQUIDITY_DEPTH_URL = process.env.LIQUIDITY_DEPTH_URL ?? "http://localhost:4002/signal";
const YIELD_SCORE_URL = process.env.YIELD_SCORE_URL ?? "http://localhost:4003/signal";

const WALLET_RISK_PRICE = BigInt(process.env.WALLET_RISK_PRICE ?? "1000");
const LIQUIDITY_DEPTH_PRICE = BigInt(process.env.LIQUIDITY_DEPTH_PRICE ?? "2000");
const YIELD_SCORE_PRICE = BigInt(process.env.YIELD_SCORE_PRICE ?? "1500");

const WALLET_RISK_PAYTO = (process.env.WALLET_RISK_PAYTO ?? "") as Address;
const LIQUIDITY_DEPTH_PAYTO = (process.env.LIQUIDITY_DEPTH_PAYTO ?? "") as Address;
const YIELD_SCORE_PAYTO = (process.env.YIELD_SCORE_PAYTO ?? "") as Address;

const TOKEN_ADDRESS = (process.env.TOKEN_ADDRESS ?? "") as `0x${string}`;
const TOKEN_NAME = process.env.TOKEN_NAME ?? "Beacon USD";
const TOKEN_VERSION = process.env.TOKEN_VERSION ?? "1";
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL ?? "bUSD";

if (!PRIVATE_KEY) throw new Error("SIGNAL_PRIVATE_KEY required");
if (!isAddress(PAY_TO)) throw new Error("PAY_TO required");
if (!isAddress(TOKEN_ADDRESS)) throw new Error("TOKEN_ADDRESS required");
for (const addr of [WALLET_RISK_PAYTO, LIQUIDITY_DEPTH_PAYTO, YIELD_SCORE_PAYTO]) {
  if (!isAddress(addr)) {
    throw new Error("WALLET_RISK_PAYTO / LIQUIDITY_DEPTH_PAYTO / YIELD_SCORE_PAYTO required");
  }
}

const account = privateKeyToAccount(PRIVATE_KEY);
const payerAccount = privateKeyToAccount(PAYER_PRIVATE_KEY);
const isTestnet = CHAIN_ID === 1952;
const chain = isTestnet ? xLayerTestnet : xLayer;
const settlementWallet = isTestnet ? xLayerTestnetWalletClient(account) : xLayerWalletClient(account);
const payerWallet = isTestnet
  ? xLayerTestnetWalletClient(payerAccount)
  : xLayerWalletClient(payerAccount);

const token: SettlementToken = {
  address: TOKEN_ADDRESS,
  symbol: TOKEN_SYMBOL,
  decimals: 6,
  eip712Name: TOKEN_NAME,
  eip712Version: TOKEN_VERSION,
};

interface WalletRiskOutput { address: Address; score: number; band: "low" | "medium" | "high"; }
interface LiquidityDepthOutput { liquidity: string; tokens: { symbol0: string; symbol1: string }; }
interface YieldScoreOutput { asset: Address; bestSupply: { venue: string; apyPct: string } | null; }

function depthScore(liquidityRaw: string): number {
  const n = BigInt(liquidityRaw);
  if (n === 0n) return 0;
  const bits = n.toString(2).length;
  const log10 = bits / 3.32;
  return Math.min(100, Math.round((log10 - 6) * 20));
}

const composite = defineComposite({
  slug: "safe-yield",
  description:
    "Composite: safety-adjusted yield recommendation for deploying capital on X Layer. Cascades x402 payments to wallet-risk, liquidity-depth, yield-score.",
  price: PRICE,
  payTo: PAY_TO,
  token,
  chainId: CHAIN_ID,
  settlementWallet,
  payerWallet,
  // All upstreams use the same settlement token on testnet — resolver returns it.
  upstreamTokenResolver: () => token,
  // Map the buyer's `?asset=0x…` into the param each upstream expects.
  upstreamQuery: (ctx, up) => {
    const asset = ctx.req.query("asset") ?? "";
    const slug = up.url.includes("wallet-risk")
      ? "wallet-risk"
      : up.url.includes("liquidity-depth")
        ? "liquidity-depth"
        : "yield-score";
    if (slug === "wallet-risk") return { address: asset };
    if (slug === "liquidity-depth") {
      return {
        tokenA: TOKEN_ADDRESS,
        tokenB: asset,
        fee: "3000",
      };
    }
    return { asset };
  },
  upstream: [
    { url: WALLET_RISK_URL, price: WALLET_RISK_PRICE, shareBps: 3000, payTo: WALLET_RISK_PAYTO },
    { url: LIQUIDITY_DEPTH_URL, price: LIQUIDITY_DEPTH_PRICE, shareBps: 3000, payTo: LIQUIDITY_DEPTH_PAYTO },
    { url: YIELD_SCORE_URL, price: YIELD_SCORE_PRICE, shareBps: 3000, payTo: YIELD_SCORE_PAYTO },
  ],
  handler: async ({ ctx, upstreams }) => {
    const asset = ctx.req.query("asset");
    if (!asset || !isAddress(asset)) throw new Error("valid ?asset=0x... required");

    const wr = upstreams["wallet-risk"]?.data as WalletRiskOutput | undefined;
    const ld = upstreams["liquidity-depth"]?.data as LiquidityDepthOutput | undefined;
    const ys = upstreams["yield-score"]?.data as YieldScoreOutput | undefined;

    const riskPenalty = wr ? wr.score : 50;
    const depth = ld ? depthScore(ld.liquidity) : 0;
    const apyPct = ys?.bestSupply ? Number(ys.bestSupply.apyPct) : 0;

    const safety = Math.max(0, Math.round(100 - riskPenalty * 0.5 + depth * 0.3));
    const recommendation =
      safety >= 70 && apyPct >= 2 ? "deploy_full" :
      safety >= 50 ? "deploy_partial" : "hold";

    return {
      asset, safetyScore: safety, expectedApyPct: apyPct, recommendation,
      bestVenue: ys?.bestSupply?.venue ?? null,
      components: {
        walletRisk: wr ?? null,
        liquidityDepth: ld ? { depthScore: depth, tokens: ld.tokens, liquidity: ld.liquidity } : null,
        yieldScore: ys ?? null,
      },
    };
  },
  onSettled: ({ payer, amount, txHash }) => {
    console.log(`[safe-yield] settled: payer=${payer} amount=${amount} tx=${txHash}`);
  },
});

const app = new Hono();
app.get("/", (c: Context) =>
  c.json({
    service: "beacon:safe-yield",
    endpoint: "/signal",
    meta: "/signal/meta",
    cascade: composite.upstream.map((u) => ({ url: u.url, shareBps: u.shareBps })),
  })
);
app.route("/signal", composite.app);

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`safe-yield listening on :${info.port} (chain ${CHAIN_ID})`);
});
