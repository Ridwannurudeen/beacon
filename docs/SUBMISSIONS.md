# OKX Build X Hackathon — Submission Drafts

Two submissions, one codebase. Fill the Google Form twice. Do **not** submit before final approval.

---

## X Layer Arena — "Beacon"

**Project name**: Beacon

**One-liner**: The signal layer of Onchain OS — composable, live-priced intelligence for agents on X Layer.

**Track**: X Layer Arena

**Deployment chain**: X Layer mainnet (chainId 196)

**Contract addresses** (fill after deploy):
- `SignalRegistry`: `0x...`
- `PaymentSplitter`: `0x...`

**Agentic Wallet address** (payer for cascade demo): `0x...`

**GitHub**: https://github.com/Ridwannurudeen/beacon

**Demo video**: https://youtube.com/… (3-minute walkthrough, see `DEMO_SCRIPT.md`)

**Summary** (300 words max):

> Beacon turns live intelligence into a programmable economy on X Layer. Every signal is an x402 resource priced per call in USDT0; composite signals cascade payments to upstream authors by protocol — the composite cannot serve a call without paying its bases, because serving IS the fan-out.
>
> Agents buy intelligence via the Signal SDK's `fetchWithPayment()` or the Beacon MCP server (Claude Desktop, Cursor, any MCP client). Publishers define a signal with `defineSignal({ slug, price, handler })` and are live in minutes. Composite authors declare their upstreams + basis-point share split with `defineComposite({ upstream, shareBps })` and earn a margin on every consumption.
>
> Three base signals ship today: wallet-risk (on-chain risk scoring), liquidity-depth (Uniswap v3 pool reader on X Layer), yield-score (normalized APY across X Layer lending venues). The reference composite safe-yield cascades across all three at 30/30/30 with 10% author margin.
>
> The on-chain `SignalRegistry` (audited by 23 tests, OpenZeppelin imports, custom errors, dedup-protected call recording) indexes authorship, pricing, composition graph, and cumulative x402 revenue per signal. `PaymentSplitter` handles multi-recipient pull-based distribution with SafeERC20 + ReentrancyGuard.
>
> The Autopilot vertical is the agentic savings account: a user deposits USDT0, subscribes to safe-yield, and the Agentic Wallet routes through the best X Layer venue, paying the cascade on every rebalance tick. The UI renders the four-settlement cascade graph in real time on X Layer.
>
> Why this wins: protocol-level royalty cascade is genuinely novel, hits every hackathon scoring axis, locks four specials (x402, economy loop, MCP, most active agent), and positions as **infrastructure for** X Layer, not just **on** it.

**Onchain OS / Uniswap skill usage**:

- Uniswap v3 pool reader via `liquidity-depth` signal (slot0, liquidity, reserves, tick, sqrtPrice)
- x402 `exact` scheme on X Layer via custom EIP-3009 server using `@x402/evm` primitives (Coinbase v1 SDK does not support X Layer; we built compliant with v2 `${string}:${string}` network format)
- Agentic Wallet as payer / composite wallet / MCP signer
- Trade Skills compatible (safe-yield output maps to OKX Trade routing params)

**Architecture overview**: See README.md Architecture section. Monorepo with 4 packages, 4 signal servers, Hardhat contracts, Vite landing + Autopilot UI.

**Working mechanics**: Every call flow ends in four on-chain settlements visible on oklink.com/xlayer, cross-referenced with `SignalRegistry.CallRecorded` events and `PaymentSplitter.Distributed` events.

**Team**: [single builder name / handle]

**X post**: https://x.com/… (include `#XLayerHackathon` + `@XLayerOfficial`)

**Special prizes claimed**: Best x402 application, Best economy loop, Best MCP integration, Most active agent.

---

## Skills Arena — "@beacon/sdk"

**Project name**: @beacon/sdk — composable x402 signal primitives for X Layer

**One-liner**: A TypeScript SDK that turns any HTTP endpoint into a per-call-priced agentic signal, with native support for multi-author payment cascades.

**Track**: Skills Arena

**Skill module**: `defineSignal` + `defineComposite` + `fetchWithPayment`

**GitHub** (same monorepo, focus on `packages/sdk/`): https://github.com/Ridwannurudeen/beacon/tree/main/packages/sdk

**npm**: `@beacon/sdk` (published at submission time)

**Contract addresses on X Layer** (bonus for Skills Arena X Layer deploy): see X Layer Arena submission

**Summary** (300 words max):

> @beacon/sdk is the developer primitive behind Beacon. Three exports turn any TypeScript service into an x402-monetized signal on X Layer:
>
> **`defineSignal({ slug, price, handler })`** — mounts a Hono sub-app that serves 402 Payment Required with EIP-3009 `transferWithAuthorization` requirements, verifies the buyer's typed-data signature against the USDT0 domain on X Layer, optionally settles on-chain by relaying the signed authorization to the token contract, runs the handler, and returns the settlement tx hash in the response header.
>
> **`defineComposite({ upstream, shareBps })`** — the payment cascade primitive. Wraps `defineSignal` with a fan-out that, before running the composite's handler, issues `fetchWithPayment()` calls to each declared upstream using the composite's own wallet. Upstream authors are paid structurally; the composite cannot serve without paying. Response surfaces every cascade tx hash to the buyer.
>
> **`fetchWithPayment(url, walletClient)`** — the client. Attempts the first GET unpaid; on 402, parses `PaymentRequired.accepts[]`, constructs an EIP-3009 `TransferWithAuthorization`, signs EIP-712 via the buyer's wallet, base64-encodes into `X-Payment`, retries, and returns the final 200 response.
>
> Full X Layer support (chainId 196, `evm:196` network string, USDT0 settlement) is first-class. Switching to X Layer testnet is one config line. Unlike Coinbase's v1 x402 SDK which hardcodes a Zod network enum that excludes X Layer, Beacon targets the v2 `${string}:${string}` contract and ships its own spec-compliant server using `@x402/evm` primitives + viem.
>
> Skills Arena use cases: any API (Dune, Nansen wrapper, LLM judge, oracle aggregator) becomes a tradeable signal in five minutes. Composite authors can build bundles without running their own data — they just compose and earn a margin.

**Onchain OS / Uniswap skill usage**: Native. Reference signal (`liquidity-depth`) reads Uniswap v3 pool state on X Layer. SDK itself is designed to compose with Trade and Market Skills.

**Integration depth**: Custom chain config for X Layer in viem, canonical USDT0/USDC EIP-712 domains pre-wired, Agentic Wallet compatible (any viem `WalletClient` works as signer).

**Team**: [single builder name / handle]

**Special prizes claimed**: Best data analyst (liquidity-depth), Best Uniswap integration (liquidity-depth uses v3 pool math), Most innovative (composite cascade primitive).

---

## Post-submission flight plan

1. Publish `@beacon/sdk` to npm (`npm publish --access public` from `packages/sdk`)
2. Publish `@beacon/mcp` to npm
3. Submit Plugin Store form (if Skills Arena 1st requires manual listing)
4. Tweet thread with demo video + cascade gif, tag `@XLayerOfficial #XLayerHackathon #onchainos`
5. Ship the Beacon MCP config snippet for Claude Desktop users
6. Cross-post in 3 agent-developer Discords (pre-identified: X Layer Builder Hub, MCP community, viem discord)
