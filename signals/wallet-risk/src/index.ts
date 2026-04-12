import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, isAddress, type Address } from "viem";
import {
  defineSignal,
  xLayerTestnet,
  xLayerTestnetWalletClient,
  xLayer,
  xLayerWalletClient,
  type SettlementToken,
} from "@beacon/sdk";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * wallet-risk — Beacon base signal.
 *
 * Scores an EVM wallet on X Layer (testnet or mainnet) for risk across
 * account activity, bytecode exposure, and sanctions proximity.
 */

const PRIVATE_KEY = (process.env.SIGNAL_PRIVATE_KEY ?? "") as `0x${string}`;
const PAY_TO = (process.env.PAY_TO ?? "") as Address;
const PORT = Number(process.env.PORT ?? 4001);
const PRICE = BigInt(process.env.PRICE ?? "1000");
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 195); // default X Layer testnet

const TOKEN_ADDRESS = (process.env.TOKEN_ADDRESS ?? "") as `0x${string}`;
const TOKEN_NAME = process.env.TOKEN_NAME ?? "Beacon USD";
const TOKEN_VERSION = process.env.TOKEN_VERSION ?? "1";
const TOKEN_SYMBOL = process.env.TOKEN_SYMBOL ?? "bUSD";

if (!PRIVATE_KEY) throw new Error("SIGNAL_PRIVATE_KEY required");
if (!isAddress(PAY_TO)) throw new Error("PAY_TO required");
if (!isAddress(TOKEN_ADDRESS)) throw new Error("TOKEN_ADDRESS required");

const account = privateKeyToAccount(PRIVATE_KEY);
const isTestnet = CHAIN_ID === 195;
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

const SANCTIONED = new Set<string>([
  "0x722122df12d4e14e13ac3b6895a86e84145b6967".toLowerCase(),
]);

interface RiskOutput {
  address: Address;
  score: number;
  band: "low" | "medium" | "high";
  factors: Array<{ name: string; weight: number; detail: string }>;
  blockNumber: string;
}

async function scoreWallet(address: Address): Promise<RiskOutput> {
  const factors: RiskOutput["factors"] = [];
  let score = 0;

  const nonce = await publicClient.getTransactionCount({ address });
  if (nonce === 0) {
    score += 15;
    factors.push({ name: "unused_account", weight: 15, detail: "no outgoing txs" });
  } else if (nonce > 500) {
    score += 10;
    factors.push({ name: "high_activity", weight: 10, detail: `${nonce} txs` });
  }

  const code = await publicClient.getCode({ address });
  if (code && code !== "0x") {
    score += 25;
    factors.push({
      name: "contract_account",
      weight: 25,
      detail: "bytecode deployed — verify contract source before interacting",
    });
  }

  if (SANCTIONED.has(address.toLowerCase())) {
    score += 60;
    factors.push({ name: "sanctioned", weight: 60, detail: "on internal sanction list" });
  }

  score = Math.min(100, score);
  const band: RiskOutput["band"] = score < 25 ? "low" : score < 60 ? "medium" : "high";

  const block = await publicClient.getBlockNumber();
  return { address, score, band, factors, blockNumber: block.toString() };
}

const signal = defineSignal({
  slug: "wallet-risk",
  description:
    "Scores an EVM wallet on X Layer for risk across activity, contract exposure, and sanctions proximity.",
  price: PRICE,
  payTo: PAY_TO,
  token,
  chainId: CHAIN_ID,
  settlementWallet,
  handler: async (c) => {
    const addr = c.req.query("address");
    if (!addr || !isAddress(addr)) throw new Error("valid ?address=0x... required");
    return scoreWallet(addr);
  },
  onSettled: ({ payer, amount, txHash }) => {
    console.log(`[wallet-risk] settled: payer=${payer} amount=${amount} tx=${txHash}`);
  },
});

const app = new Hono();
app.get("/", (c: Context) =>
  c.json({
    service: "beacon:wallet-risk",
    endpoint: "/signal",
    meta: "/signal/meta",
    chain: { id: CHAIN_ID, name: chain.name },
  })
);
app.route("/signal", signal.app);

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`wallet-risk listening on :${info.port} (chain ${CHAIN_ID})`);
});
