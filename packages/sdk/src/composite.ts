import type { Context } from "hono";
import type { Address, Hex, WalletClient } from "viem";
import { defineSignal, type DefineSignalOptions } from "./signal.js";
import { fetchWithPayment } from "./client.js";
import type { SettlementToken } from "./chains.js";
import type { CompositeFetchResult, UpstreamDependency } from "./types.js";

export interface DefineCompositeOptions<TOutput>
  extends Omit<DefineSignalOptions<TOutput>, "handler"> {
  upstream: UpstreamDependency[];
  /** Wallet paying upstreams on every composite call. */
  payerWallet: WalletClient;
  /**
   * Token resolver for upstream 402 responses. Needed on testnet where signals
   * advertise a self-deployed EIP-3009 token whose EIP-712 domain can't be looked
   * up from a hardcoded table.
   */
  upstreamTokenResolver?: (assetAddress: Address) => SettlementToken;
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

  const wrapped: DefineSignalOptions<{
    output: TOutput;
    cascade: Array<{ slug: string; paymentTx?: Hex; upstream: Address }>;
  }> = {
    ...opts,
    handler: async (ctx) => {
      const cascade: Array<{ slug: string; paymentTx?: Hex; upstream: Address }> = [];
      const upstreams: Record<string, CompositeFetchResult> = {};

      await Promise.all(
        Array.from(upstreamBySlug.entries()).map(async ([slug, up]) => {
          const res = await fetchWithPayment(up.url, opts.payerWallet, undefined, {
            chainId: opts.chainId,
            tokenResolver: opts.upstreamTokenResolver
              ? (option) => opts.upstreamTokenResolver!(option.asset)
              : undefined,
          });
          if (res.status !== 200) {
            throw new Error(`upstream ${slug} failed ${res.status}`);
          }
          const data = await res.json();
          const rh = res.headers.get("X-Payment-Response");
          const paymentTx = rh
            ? (JSON.parse(Buffer.from(rh, "base64").toString()).transaction as Hex)
            : undefined;
          upstreams[slug] = { upstreamUrl: up.url, data, paymentTx };
          cascade.push({ slug, paymentTx, upstream: up.payTo });
        })
      );

      const output = await opts.handler({ ctx, upstreams });
      return { output, cascade };
    },
  };

  const signal = defineSignal(wrapped);
  return { ...signal, upstream: opts.upstream };
}

function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[0] ?? u.host;
  } catch {
    return url;
  }
}
