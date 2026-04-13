# OKX Build X Hackathon — Submission Drafts

Two submissions, one codebase. Fill the Google Form twice. **DO NOT SUBMIT WITHOUT EXPLICIT USER APPROVAL.**

---

## X Layer Arena — "Atlas"

**Project name**: Atlas — Decentralized AI Hedge Fund on X Layer

**One-liner**: Deposit bUSD. Three AI agents trade your capital. Profitable strategies earn more. Every signal they consume is paid for on-chain via x402 — intelligence costs are real performance drag, not theater.

**Track**: X Layer Arena

**Deployment chain**: X Layer testnet (chainId 1952)

**Contract addresses**:
- `AtlasVault`: `0x113b660d9F53015cc3478f595835554A5DB7dff2`
- `AgentRegistry`: `0x2F41E56C09BB117dD8F1E3B648ADA403e460c454`
- `DemoAMM`: `0x54F90b6D39284806639Bf376C28FA07d3547Cd76`
- `MockX`: `0x320830a9094e955EdD366802127f4F056CF4B08B`
- `SignalRegistry` (Beacon): `0x02D1f2324D9D7323CB27FC504b846e9CB2020433`
- `PaymentSplitter` (Beacon): `0xaD5FE8f63143Fae56D097685ECF99BEEc612169a`
- `bUSD` (TestToken, EIP-3009): `0xe5A5A31145dc44EB3BD701897cd825b2443A6B76`

**Agentic Wallet addresses** (the 3 competing agents):
- Fear: `0x4fc3a3848fFc74f1B608A3961D27F07e4216ae4F`
- Greed: `0x411C0Ec26BE4628e79090f4e35f9D45079767785`
- Skeptic: `0x94f94a111cBBd5e33ec440A199542955a307bB8e`

**GitHub**: https://github.com/Ridwannurudeen/beacon

**Live URL**: https://beacon.gudman.xyz

**Demo video**: [URL after recording]

**Summary** (300 words max):

> Atlas is the first product where x402 micropayments carry economic weight, not just demo theater. It is a decentralized AI hedge fund on X Layer testnet: anyone deposits bUSD into AtlasVault and receives ATLS shares pro-rata to live NAV. Three competing AI agents — Fear (momentum), Greed (mean reversion), Skeptic (signal-driven) — allocate that capital across a Uniswap-v2-math AMM, trading bUSD against MOCK-X. Their PnL is tracked on AgentRegistry; the leaderboard updates every minute and will outlast the hackathon.
>
> The novel mechanic: Skeptic, before every potential trade, queries Beacon's `safe-yield` composite signal. The composite cascades the x402 payment to three upstream signal authors (wallet-risk, liquidity-depth, yield-score) — by protocol, not by honor. One Skeptic call produces four on-chain settlements on X Layer. Skeptic's signal costs come directly out of its book, so if its intelligence-driven decisions don't beat Fear's naive momentum, the data was overpriced and Skeptic loses to the leaderboard.
>
> This makes the cascade economically meaningful for the first time. Other x402 demos pay themselves in mock tokens for mock data. Atlas puts cascades on the critical path of a real capital allocation game where intelligence has measurable value or measurable cost.
>
> Stack: 7 audited Solidity contracts (32/32 tests pass), TypeScript signal SDK with `defineSignal`/`defineComposite`/`fetchWithPayment` published as `@beacon/sdk`, MCP server exposing signals to any Claude/Cursor agent, agent-runner with three strategies + a market mover, Vite dashboard with live cascade feed. All deployed on X Layer testnet (chainId 1952), all running on `*.gudman.xyz` subdomains.

**Onchain OS / Uniswap skill usage**:
- Custom x402 server using `@x402/evm` v2 primitives because Coinbase v1 SDK doesn't support X Layer (network enum hardcoded). v2's `${string}:${string}` network format accepts `evm:1952`.
- Uniswap v3 pool reader via `liquidity-depth` signal.
- Uniswap v2 math (xy=k + 0.3% fee) in DemoAMM — agents' strategies are portable to Uniswap deployments with one-line swap.
- Agentic Wallet pattern: each agent has its own EOA, signs its own x402 payments, manages its own book.

**Architecture overview**: See `README.md` Architecture section. Monorepo with 7 contracts, 4 signal servers, atlas/agent-runner, MCP server, Vite dashboard.

**Working mechanics**:
1. Mover seeds AMM noise every 2 ticks
2. Each agent reads spot price + own book + history
3. Strategy returns Decision (buy/sell/hold)
4. Skeptic optionally pre-queries safe-yield via x402 → cascades to 3 upstreams
5. Trades execute on DemoAMM with 5% slippage tolerance
6. recordTrade + recordSignal land on AgentRegistry
7. Vault NAV recomputes from agent balances on next read

**Team**: Ridwan Nurudeen / @ggudman

**X post**: [URL after posting]

**Special prizes claimed**: Best x402 application, Best economy loop, Best MCP integration, Most active agent.

---

## Skills Arena — "@beacon/sdk"

**Project name**: @beacon/sdk — composable x402 signal primitives for X Layer

**One-liner**: A TypeScript SDK that turns any HTTP endpoint into a per-call-priced agentic signal, with native support for multi-author payment cascades. The intelligence layer Atlas runs on top of.

**Track**: Skills Arena

**Skill module**: `defineSignal` + `defineComposite` + `fetchWithPayment`

**GitHub** (focus on `packages/sdk/`): https://github.com/Ridwannurudeen/beacon/tree/main/packages/sdk

**Contract addresses on X Layer testnet** (Beacon's on-chain layer):
- `SignalRegistry`: `0x02D1f2324D9D7323CB27FC504b846e9CB2020433`
- `PaymentSplitter`: `0xaD5FE8f63143Fae56D097685ECF99BEEc612169a`
- `bUSD` (settlement token): `0xe5A5A31145dc44EB3BD701897cd825b2443A6B76`

**Live signal endpoints**:
- https://wallet-risk.gudman.xyz/signal
- https://liquidity-depth.gudman.xyz/signal
- https://yield-score.gudman.xyz/signal
- https://safe-yield.gudman.xyz/signal (composite, cascades to all 3 above)

**Summary** (300 words max):

> @beacon/sdk turns any TypeScript service into an x402-monetized signal on X Layer. Three exports cover the developer surface:
>
> **`defineSignal({ slug, price, handler })`** — mounts a Hono sub-app that serves `402 Payment Required` with EIP-3009 `transferWithAuthorization` requirements, verifies the buyer's typed-data signature against the settlement token's domain, optionally settles on-chain by relaying the authorization to the token contract, runs the handler, returns the settlement tx hash in `X-Payment-Response`.
>
> **`defineComposite({ upstream, shareBps })`** — the cascade primitive. Wraps `defineSignal` with a fan-out: before running the composite's handler, issues `fetchWithPayment` calls to each declared upstream from the composite's own wallet. Upstream authors are paid structurally — the composite cannot serve a call without paying its bases. Cascade tx hashes surface in the response so consumers can render the payment graph.
>
> **`fetchWithPayment(url, walletClient)`** — the client. Attempts a GET unpaid; on 402, parses `PaymentRequired.accepts[]`, signs an EIP-3009 authorization for the chosen option, encodes into `X-Payment` header, retries.
>
> First-class X Layer support (chainId 196 mainnet, 1952 testnet, `evm:1952` network string, USDT0/bUSD settlement) is built in. Coinbase's v1 x402 SDK hardcodes a Zod network enum that excludes X Layer; @beacon/sdk targets the v2 `${string}:${string}` contract and ships its own spec-compliant Hono server using `@x402/evm` primitives + viem.
>
> The reference deployment is the Atlas hedge fund — three competing AI agents that trade on X Layer, with Skeptic paying Beacon's `safe-yield` composite before every decision. The cascade is economically real because it shows up as drag on Skeptic's PnL.

**Special prizes claimed**: Best data analyst (liquidity-depth — Uniswap v3 pool math), Best Uniswap integration, Most innovative (composite cascade primitive).

---

## Post-submission flight plan

1. Publish `@beacon/sdk` to npm
2. Publish `@beacon/mcp` to npm
3. Tweet thread with demo video, tag `@XLayerOfficial #XLayerHackathon #onchainos`
4. Cross-post in 2-3 agent-developer Discords
5. Submit Onchain OS Plugin Store listing if Skills Arena 1st place is awarded
