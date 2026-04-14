import type { Context } from "hono";
import { keccak256, encodePacked, type Address, type Hex, type WalletClient } from "viem";
import { defineSignal, type DefineSignalOptions } from "./signal.js";
import { fetchWithPayment } from "./client.js";
import type { SettlementToken } from "./chains.js";
import type { CompositeFetchResult, UpstreamDependency } from "./types.js";
import {
  buildCascadeDomain,
  encodeCascadeReceiptHeader,
  signCascadeReceipt,
  type CascadeReceipt,
  type UpstreamPayment,
} from "./receipt.js";

export interface DefineCompositeOptions<TOutput>
  extends Omit<DefineSignalOptions<TOutput>, "handler"> {
  upstream: UpstreamDependency[];
  /** Wallet paying upstreams on every composite call. */
  payerWallet: WalletClient;
  /**
   * Token resolver for upstream 402 responses. Needed on testnet where signals
   * advertise a self-deployed EIP-3009 token whose EIP-712 domain can't be
   * looked up from a hardcoded table.
   */
  upstreamTokenResolver?: (assetAddress: Address) => SettlementToken;
  /**
   * Transform the buyer's HTTP request into the query string each upstream
   * expects. Default: forward the buyer's query string unchanged.
   */
  upstreamQuery?: (
    ctx: Context,
    upstream: UpstreamDependency
  ) => Record<string, string>;
  /**
   * Optional on-chain CascadeLedger address. Receipts are signed against this
   * contract's EIP-712 domain so callers can submit them for deterministic
   * event emission. Defaults to address(0) — signatures are still valid, just
   * with no on-chain home.
   */
  cascadeLedger?: Address;
  handler: (args: {
    ctx: Context;
    upstreams: Record<string, CompositeFetchResult>;
  }) => Promise<TOutput> | TOutput;
}

export function defineComposite<TOutput>(opts: DefineCompositeOptions<TOutput>) {
  const upstreamBySlug = new Map<string, UpstreamDependency>();
  for (const up of opts.upstream) {
    upstreamBySlug.set(slugFromUrl(up.url), up);
  }

  const compositeAddress = opts.payerWallet.account?.address;
  if (!compositeAddress) {
    throw new Error("defineComposite: payerWallet must have an account (for receipt signing)");
  }

  const wrapped: DefineSignalOptions<{
    output: TOutput;
    cascade: Array<{ slug: string; paymentTx?: Hex; upstream: Address }>;
  }> = {
    ...opts,
    handler: async (ctx) => {
      const cascade: Array<{ slug: string; paymentTx?: Hex; upstream: Address }> = [];
      const upstreamPayments: UpstreamPayment[] = [];
      const upstreams: Record<string, CompositeFetchResult> = {};

      await Promise.all(
        Array.from(upstreamBySlug.entries()).map(async ([slug, up]) => {
          const url = new URL(up.url);
          const queryParams = opts.upstreamQuery
            ? opts.upstreamQuery(ctx, up)
            : forwardAllQuery(ctx);
          for (const [k, v] of Object.entries(queryParams)) {
            url.searchParams.set(k, v);
          }
          const res = await fetchWithPayment(url.toString(), opts.payerWallet, undefined, {
            chainId: opts.chainId,
            tokenResolver: opts.upstreamTokenResolver
              ? (option) => opts.upstreamTokenResolver!(option.asset)
              : undefined,
          });
          if (res.status !== 200) {
            const bodyText = await res.text().catch(() => "");
            throw new Error(`upstream ${slug} failed ${res.status} ${bodyText}`);
          }
          const data = await res.json();
          const rh = res.headers.get("X-Payment-Response");
          const paymentTx = rh
            ? (JSON.parse(Buffer.from(rh, "base64").toString()).transaction as Hex)
            : undefined;
          upstreams[slug] = { upstreamUrl: up.url, data, paymentTx };
          cascade.push({ slug, paymentTx, upstream: up.payTo });
          if (paymentTx) {
            upstreamPayments.push({
              slug,
              author: up.payTo,
              amount: up.price,
              settlementTx: paymentTx,
            });
          }
        })
      );

      // Stash the cascade metadata on the Hono context so the signal wrapper can
      // lift it into a signed CascadeReceipt after the buyer's settlement lands.
      (ctx as unknown as { __beacon?: Record<string, unknown> }).__beacon = {
        cascade: upstreamPayments,
      };

      const output = await opts.handler({ ctx, upstreams });
      return { output, cascade };
    },
  };

  // Intercept the signal's onSettled so we can sign + attach a CascadeReceipt
  // to the response. The composite's payerWallet is also the signer.
  const originalOnSettled = opts.onSettled;
  const chainId = opts.chainId ?? 196;

  const signalOpts: DefineSignalOptions<{
    output: TOutput;
    cascade: Array<{ slug: string; paymentTx?: Hex; upstream: Address }>;
  }> = {
    ...wrapped,
    onSettled: async (settlement) => {
      // preserve any caller-provided hook
      if (originalOnSettled) originalOnSettled(settlement);
    },
  };

  const signal = defineSignal(signalOpts);

  // Hono middleware — attach signed CascadeReceipt after the handler runs.
  // Uses middleware (not fetch wrapping) so `app.route("/signal",
  // composite.app)` in parent servers still runs our logic. Hono's route()
  // walks the sub-app's route tree directly, bypassing fetch; middleware
  // runs on every matched request including mounted routes.
  signal.app.use("*", async (c: Context, next: () => Promise<void>) => {
    await next();
    if (!c.res || c.res.status !== 200) return;

    const paymentResponse = c.res.headers.get("X-Payment-Response");
    if (!paymentResponse) return;

    console.log(`[defineComposite] signing receipt for ${c.req.path}`);

    try {
      const decoded = JSON.parse(Buffer.from(paymentResponse, "base64").toString());
      const buyer = decoded.payer as Address;
      const buyerSettlementTx = decoded.transaction as Hex;

      const bodyText = await c.res.clone().text();
      const body = JSON.parse(bodyText) as {
        cascade?: Array<{ slug: string; paymentTx?: Hex; upstream: Address }>;
      };
      const upstreamPayments: UpstreamPayment[] = (body.cascade ?? [])
        .filter((x) => x.paymentTx)
        .map((x) => {
          const up = opts.upstream.find((u) => slugFromUrl(u.url) === x.slug);
          return {
            slug: x.slug,
            author: x.upstream,
            amount: up?.price ?? 0n,
            settlementTx: x.paymentTx as Hex,
          };
        });

      const receipt: CascadeReceipt = {
        composite: compositeAddress,
        receiptId: keccak256(
          encodePacked(["address", "bytes32"], [buyer, buyerSettlementTx])
        ),
        buyer,
        buyerAmount: opts.price,
        settlementToken: resolveTokenAddress(opts.token),
        buyerSettlementTx,
        upstreams: upstreamPayments,
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
        chainId: BigInt(chainId),
      };
      const domain = buildCascadeDomain(BigInt(chainId), opts.cascadeLedger);
      const signed = await signCascadeReceipt(opts.payerWallet, receipt, domain);

      // Reconstruct response so header mutation propagates through Hono/node-server.
      const newHeaders = new Headers(c.res.headers);
      newHeaders.set("X-Cascade-Receipt", encodeCascadeReceiptHeader(signed));
      c.res = new Response(bodyText, {
        status: c.res.status,
        statusText: c.res.statusText,
        headers: newHeaders,
      });
      console.log(`[defineComposite] receipt attached (${upstreamPayments.length} upstreams)`);
    } catch (e) {
      console.warn(`[defineComposite] receipt signing: ${(e as Error).message}`);
    }
  });

  return { ...signal, upstream: opts.upstream };
}

function resolveTokenAddress(token: unknown): Address {
  if (typeof token === "object" && token !== null && "address" in token) {
    return (token as { address: Address }).address;
  }
  // Named keys resolve via the SDK's internal table, but composites running
  // against known tokens should pass the descriptor directly. Zero as fallback.
  return "0x0000000000000000000000000000000000000000";
}

function forwardAllQuery(ctx: Context): Record<string, string> {
  const out: Record<string, string> = {};
  const all = ctx.req.query();
  if (typeof all === "object" && all !== null) {
    for (const [k, v] of Object.entries(all as Record<string, string>)) {
      out[k] = v;
    }
  }
  return out;
}

function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const generic = new Set(["signal", "api", "v1", "v2"]);
    if (parts[0] && !generic.has(parts[0])) return parts[0];
    const host = u.host.split(".")[0];
    return host ?? u.host;
  } catch {
    return url;
  }
}
