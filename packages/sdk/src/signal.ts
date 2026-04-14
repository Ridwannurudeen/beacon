import { Hono, type Context } from "hono";
import type { Address, Chain, Hex, WalletClient } from "viem";
import {
  xLayer,
  xLayerTestnet,
  X_LAYER_NETWORK,
  X_LAYER_TESTNET_NETWORK,
  resolveToken,
  type SettlementToken,
  type SettlementTokenKey,
} from "./chains.js";
import {
  isAuthorizationUsed,
  settleAuthorization,
  verifyAuthorizationSignature,
  xLayerPublicClient,
  xLayerTestnetPublicClient,
} from "./eip3009.js";
import type {
  EIP3009Authorization,
  PaymentOption,
  PaymentRequired,
  X402PaymentPayload,
  X402PaymentResponse,
} from "./types.js";

export interface DefineSignalOptions<TOutput> {
  slug: string;
  description: string;
  price: bigint;
  payTo: Address;
  handler: (ctx: Context) => Promise<TOutput> | TOutput;
  /**
   * Settlement token. Either a named mainnet key ("USDT0", "USDC") or a runtime
   * descriptor for testnet / self-deployed EIP-3009 tokens.
   */
  token?: SettlementTokenKey | SettlementToken;
  /** Chain id. Defaults to X Layer mainnet (196). For testnet pass 195. */
  chainId?: number;
  /**
   * x402 network string. Defaults to the CAIP-like form for chainId
   * (`evm:196` or `evm:195`). Override only for custom deployments.
   */
  network?: string;
  maxTimeoutSeconds?: number;
  /**
   * Wallet that relays settlement on-chain (pays gas). If omitted, SDK runs in
   * verify-only mode and a downstream facilitator must settle.
   */
  settlementWallet?: WalletClient;
  /** RPC URL override. */
  rpcUrl?: string;
  onSettled?: (settlement: {
    signalSlug: string;
    payer: Address;
    amount: bigint;
    txHash: Hex;
  }) => void;
  /**
   * Pre-route hook: receives the Hono app BEFORE its route handlers are
   * registered so callers can attach middleware that wraps them. Composites
   * use this to install the CascadeReceipt-signing middleware in the correct
   * position (middleware registered after routes never wraps them in Hono).
   */
  preRoute?: (app: Hono) => void;
}

/**
 * Publishes a single x402-priced signal as a Hono sub-app. See README for flow.
 */
export function defineSignal<TOutput>(opts: DefineSignalOptions<TOutput>) {
  const token: SettlementTokenKey | SettlementToken = opts.token ?? "USDT0";
  const tokenMeta = resolveToken(token);
  const chainId = opts.chainId ?? 196;
  const chain: Chain = chainId === 1952 ? xLayerTestnet : xLayer;
  const network =
    opts.network ?? (chainId === 1952 ? X_LAYER_TESTNET_NETWORK : X_LAYER_NETWORK);
  const maxTimeoutSeconds = opts.maxTimeoutSeconds ?? 60;
  const publicClient =
    chainId === 1952 ? xLayerTestnetPublicClient(opts.rpcUrl) : xLayerPublicClient(opts.rpcUrl);

  const paymentOption: PaymentOption = {
    scheme: "exact",
    network,
    payTo: opts.payTo,
    asset: tokenMeta.address,
    maxAmountRequired: opts.price.toString(),
    maxTimeoutSeconds,
    resource: `beacon://${opts.slug}`,
    description: opts.description,
    mimeType: "application/json",
    extra: { name: tokenMeta.eip712Name, version: tokenMeta.eip712Version },
  };

  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    error: "X-Payment header required",
    accepts: [paymentOption],
  };

  const app = new Hono();

  // Allow composites / callers to wire middleware before routes are registered
  // so their .use() actually wraps the route handlers below.
  if (opts.preRoute) opts.preRoute(app);

  app.get("/meta", (c: Context) =>
    c.json({
      slug: opts.slug,
      description: opts.description,
      network,
      chainId,
      token: {
        address: tokenMeta.address,
        symbol: tokenMeta.symbol,
        decimals: tokenMeta.decimals,
        name: tokenMeta.eip712Name,
        version: tokenMeta.eip712Version,
      },
      price: opts.price.toString(),
      payTo: opts.payTo,
      mode: opts.settlementWallet ? "self-settle" : "verify-only",
    })
  );

  app.get("/", async (c: Context) => {
    const header = c.req.header("X-Payment");
    if (!header) {
      return c.json(paymentRequired, 402);
    }

    let payload: X402PaymentPayload;
    try {
      const decoded = Buffer.from(header, "base64").toString("utf-8");
      payload = JSON.parse(decoded) as X402PaymentPayload;
    } catch {
      return c.json({ ...paymentRequired, error: "malformed X-Payment" }, 402);
    }

    if (payload.scheme !== "exact" || payload.network !== network) {
      return c.json({ ...paymentRequired, error: "unsupported scheme/network" }, 402);
    }

    const { signature, authorization: auth } = payload.payload;
    const validation = validateAuthorization(auth, opts);
    if (validation) return c.json({ ...paymentRequired, error: validation }, 402);

    try {
      await verifyAuthorizationSignature(auth, signature, token, chainId);
    } catch {
      return c.json({ ...paymentRequired, error: "bad signature" }, 402);
    }

    let txHash: Hex | undefined;
    if (opts.settlementWallet) {
      const used = await isAuthorizationUsed(publicClient, token, auth.from, auth.nonce);
      if (used) {
        return c.json({ ...paymentRequired, error: "authorization already used" }, 402);
      }
      txHash = await settleAuthorization(opts.settlementWallet, auth, signature, token, chain);
    }

    const data = await opts.handler(c);

    if (txHash && opts.onSettled) {
      opts.onSettled({
        signalSlug: opts.slug,
        payer: auth.from,
        amount: BigInt(auth.value),
        txHash,
      });
    }

    if (txHash) {
      const response: X402PaymentResponse = {
        success: true,
        transaction: txHash,
        network,
        payer: auth.from,
      };
      c.header("X-Payment-Response", Buffer.from(JSON.stringify(response)).toString("base64"));
    }

    return c.json(data satisfies unknown);
  });

  return { app, paymentOption, slug: opts.slug };
}

function validateAuthorization(
  auth: EIP3009Authorization,
  opts: DefineSignalOptions<unknown>
): string | null {
  if (auth.to.toLowerCase() !== opts.payTo.toLowerCase()) return "wrong recipient";
  if (BigInt(auth.value) < opts.price) return "insufficient payment";
  const now = Math.floor(Date.now() / 1000);
  if (now < Number(auth.validAfter)) return "authorization not yet valid";
  if (now >= Number(auth.validBefore)) return "authorization expired";
  return null;
}
