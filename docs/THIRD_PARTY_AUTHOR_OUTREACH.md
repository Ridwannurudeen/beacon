# Recruiting the first third-party Beacon signal author

**Goal**: at least one published signal authored by a developer who is NOT us,
live on the cascade feed before submission. Transforms the story from "cool
primitive" to "functioning market."

## Who to contact (priority order)

1. **@beacon/sdk early adopters** — devs who've starred the repo since launch
2. **Agent-dev Discords** — superagent.sh, Eleven Labs agent community,
   MCP-dev (MCP server author community)
3. **Onchain-data contributors** — Dune wizards, Nansen alumni, Chainalysis
   hobbyists with public portfolios
4. **OKX Build X Hackathon participants** — other builders submitting to
   either arena who'd benefit from cross-linking

## The ask

> "We're running a live x402 signal cascade on X Layer testnet for the OKX
> Build X Hackathon. Looking for one external author to publish a signal
> using `@beacon/sdk` — any HTTP endpoint that returns live data counts.
> Payout: 500 USDT bounty from our prize pool share if we place, immediate
> cascade revenue from Skeptic's ~30 calls/day. You keep the signal
> perpetually after the hackathon — it's your IP.
>
> 30-minute integration. Here's a working example: [link]. We host the
> domain; you bring the logic."

## Bounty mechanics

- **Fixed floor**: 500 USDT paid on merge-and-go-live
- **Variable**: 100% of the cumulative x402 revenue earned during the
  hackathon window (Apr 1-15) goes directly to the author's wallet — no
  intermediation, it's just their payTo address
- **Post-hackathon**: they keep the signal, can price-change, migrate, etc.

## Template Twitter DM / cold email

> Subject: quick collab — your signal live on X Layer via x402 in 30 min?
>
> Hey [name],
>
> Saw your [thing they did] — impressive. Quick pitch:
>
> I'm running a live AI agent market on X Layer for OKX's hackathon.
> Three AI agents trade real positions; one of them (Skeptic) buys signals
> via x402 before each decision. Right now all the signals are mine, which
> weakens the "ecosystem" story for judging.
>
> Looking for one external author to ship a signal before Apr 15. Could be
> anything you're already computing — on-chain activity feed, price
> oracle, sentiment score, whatever.
>
> 30 min to integrate with `@beacon/sdk`. I pay the deploy + host the
> subdomain. You get: 500 USDT bounty on go-live + all x402 revenue
> forever + permanent on-chain signal listing at
> https://beacon.gudman.xyz.
>
> Interested? Repo: https://github.com/Ridwannurudeen/beacon

## Integration instructions for the author

```ts
import { defineSignal } from "@beacon/sdk";
import { serve } from "@hono/node-server";

const signal = defineSignal({
  slug: "your-slug",
  description: "One-sentence description",
  price: 1500n,          // per-call bUSD base units
  payTo: "0xYourWallet",  // where x402 payments land
  token: { /* bUSD testnet descriptor, I'll provide */ },
  chainId: 1952,
  settlementWallet,
  handler: async (c) => {
    // Return whatever data your signal computes
    return { ... };
  },
});

serve({ fetch: signal.app.fetch, port: 4100, hostname: "0.0.0.0" });
```

I handle: subdomain DNS, nginx, HTTPS, systemd, on-chain registry
registration. You handle: the data logic.

## Status

- [ ] 3 cold outreach DMs sent
- [ ] 1 author signs on
- [ ] Signal deployed
- [ ] Cascade feed shows external author's tx
- [ ] Bounty paid on settlement
