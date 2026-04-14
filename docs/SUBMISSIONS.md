# OKX Build X Hackathon — Submission Drafts (V2)

Two submissions, one codebase. **DO NOT SUBMIT WITHOUT EXPLICIT USER APPROVAL.**

---

## X Layer Arena — "Atlas V2"

**Project name**: Atlas — On-chain AI Strategy Vault on X Layer

**One-liner**: An ERC-4626-shaped multi-strategy vault on X Layer where three AI agent strategies (Fear, Greed, Skeptic) compete for capital under real custody. Every signal the strategies consume arrives with a cryptographically signed CascadeReceipt — no heuristics, no self-reported P&L.

**Track**: X Layer Arena

**Deployment chain**: X Layer testnet (chainId 1952)

### V2 Contract addresses

- `AtlasVaultV2`: `0x2b77AAD51566aeD6ec6feba250450200997BbA22`
- `TradingStrategy "Fear"`: `0x7EaAE912FAAEC57e983CE1Fe27aBF52cf2AcA19e`
- `TradingStrategy "Greed"`: `0x49B6A043478F99F001a369cBe501273395897F8f`
- `TradingStrategy "Skeptic"`: `0x75832CF881cf1854f153e24D751e4C3bBb535d7a`
- `SlashingRegistry`: `0x39e371a7680e7754914384Dd778FF0Eb8d5B6053`
- `CascadeLedger`: `0x5abb55245023E7886234102ff338bB70FacCF761`
- `DemoAMM`: `0x54F90b6D39284806639Bf376C28FA07d3547Cd76`
- Beacon `SignalRegistry`: `0x02D1f2324D9D7323CB27FC504b846e9CB2020433`
- Beacon `PaymentSplitter`: `0xaD5FE8f63143Fae56D097685ECF99BEEc612169a`
- `bUSD` (TestToken, EIP-3009): `0xe5A5A31145dc44EB3BD701897cd825b2443A6B76`
- `MockX`: `0x320830a9094e955EdD366802127f4F056CF4B08B`

### Agent executor EOAs (zero custody — trigger-only)

- Fear: `0x4fc3a3848fFc74f1B608A3961D27F07e4216ae4F`
- Greed: `0x411C0Ec26BE4628e79090f4e35f9D45079767785`
- Skeptic: `0x94f94a111cBBd5e33ec440A199542955a307bB8e`

### Summary (300 words)

Atlas V2 is an ERC-4626-shaped on-chain AI strategy vault on X Layer testnet where three agent-operated strategies compete for capital allocation under real custody guarantees. Unlike demos where external wallets can inflate NAV, Atlas's `totalAssets()` counts only vault-idle plus the equity of vault-controlled sub-wallets owned by registered strategies. An attacker minting themselves bUSD cannot touch share price.

Strategies operate under a two-tier trust model: each strategy contract owns a deterministically-deployed SubWallet invokable only by the strategy; the strategy itself is vault-gated for capital flows. Off-chain agent runners submit signed TradeIntents to `TradingStrategy.submitAction`, which validates and executes the swap on-chain. Executors have zero custody. P&L derives from on-chain balance snapshots inside `IStrategy.report()` — no agent-supplied PnL.

The composite signal cascade is cryptographic. Every response ships with an EIP-712-signed `CascadeReceipt` listing every upstream author, amount, and settlement tx hash. The `CascadeLedger` contract accepts receipts, verifies signatures, emits deterministic `CascadeSettled` + `UpstreamPaid` events. Indexers build the payment graph from events — no heuristic block-window matching, no trust in the composite server.

`SlashingRegistry` adds economic accountability: strategies post stake, fraud claims with bonds trigger challenge windows, unresolved claims slash stake to a treasury. Legitimate rebuttals burn the claimant's bond.

42/42 contract tests pass, including an adversarial suite targeting every flaw that a public review flagged in the earlier V1: NAV inflation via open-mint tokens, sub-wallet custody breach, self-reported P&L manipulation, cascade forgery, withdraw-while-allocated safety.

**Onchain OS / Uniswap skill usage**: Custom x402 server built on `@x402/evm` v2 primitives (Coinbase v1 SDK hardcodes a Zod network enum that excludes X Layer). Uniswap V2 math in DemoAMM; Uniswap V3 pool reader in the `liquidity-depth` signal. Every layer integrates X Layer natively.

**GitHub**: https://github.com/Ridwannurudeen/beacon

**Live URL**: https://beacon.gudman.xyz

**Demo video**: [TBD — record per `docs/DEMO_SCRIPT.md`]

**Team**: Ridwan Nurudeen / @ggudman

**Special prizes claimed**: Best x402 application (signed cascade receipts), Best economy loop (vault → allocation → strategy → harvest → reallocation), Best MCP integration (@beacon/mcp exposes signals to any Claude/Cursor agent), Most active agent (3 executors continuously submitting intents).

---

## Skills Arena — "@beacon/sdk v1.0"

**Project name**: @beacon/sdk — composable x402 signal primitives with cryptographic cascade receipts

**One-liner**: The first TypeScript SDK for X Layer that turns any HTTP endpoint into a per-call-priced agentic signal. Composites cascade payments to upstream authors by protocol. Every response is a cryptographically signed CascadeReceipt — not heuristic matching.

**Track**: Skills Arena

**Skill module**: `defineSignal` + `defineComposite` + `fetchWithPayment` + `signCascadeReceipt` + `verifyCascadeReceipt`

**GitHub** (`packages/sdk/`): https://github.com/Ridwannurudeen/beacon/tree/main/packages/sdk

**npm**: `@beacon/sdk@1.0.0` (ready to publish — `npm publish --access public` in `packages/sdk`)

### On-chain substrate

- `SignalRegistry`: `0x02D1f2324D9D7323CB27FC504b846e9CB2020433`
- `PaymentSplitter`: `0xaD5FE8f63143Fae56D097685ECF99BEEc612169a`
- `CascadeLedger`: `0x5abb55245023E7886234102ff338bB70FacCF761`
- `bUSD` (EIP-3009 settlement): `0xe5A5A31145dc44EB3BD701897cd825b2443A6B76`

### Live signal endpoints

- https://wallet-risk.gudman.xyz/signal
- https://liquidity-depth.gudman.xyz/signal
- https://yield-score.gudman.xyz/signal
- https://safe-yield.gudman.xyz/signal (composite — signs CascadeReceipts)

### Summary (300 words)

`@beacon/sdk` is the TypeScript SDK behind Atlas. Three exports cover the developer surface:

**`defineSignal({ slug, price, handler })`** — mounts a Hono sub-app that serves `402 Payment Required` with EIP-3009 `transferWithAuthorization` requirements, verifies the buyer's typed-data signature against the settlement token's domain, settles on-chain, runs the handler, returns the settlement tx hash in `X-Payment-Response`.

**`defineComposite({ upstream, shareBps })`** — the cascade primitive. Wraps `defineSignal` with automatic fan-out: before running the composite's handler, issues `fetchWithPayment` calls to each declared upstream from the composite's own wallet. After serving, signs an EIP-712 `CascadeReceipt` carrying the full upstream payment graph and ships it in `X-Cascade-Receipt`. Any consumer verifies cryptographically — no trust in the composite server, no heuristic block-window matching.

**`fetchWithPayment(url, walletClient)`** — the client. Auto-negotiates 402 → signs EIP-3009 → retries with `X-Payment` → returns the final response plus cascade receipt.

The reference application is Atlas: three AI agent strategies on an on-chain vault, Skeptic's pre-trade signal queries prove whether the cascade generates alpha (or doesn't — the market decides).

Coinbase's v1 x402 SDK hardcodes a Zod network enum that excludes X Layer. `@beacon/sdk` targets the v2 `${string}:${string}` contract via `@x402/evm` and works natively on X Layer mainnet (chainId 196) and testnet (chainId 1952).

Optional on-chain `CascadeLedger` contract accepts signed receipts, emits deterministic events, gives indexers a first-class cascade-graph data source.

**Special prizes claimed**: Best data analyst (`liquidity-depth` reads Uniswap v3 pool math on X Layer), Best Uniswap integration, Most innovative (signed CascadeReceipt is a novel primitive).

---

## Honest framing notes

- V1 Atlas (earlier addresses, still running on the VPS) had review-flagged flaws: NAV manipulation via external EOAs, self-reported P&L, heuristic cascade matching, fake deposit flow.
- V2 rebuilds the trust spine: real custody via vault-controlled sub-wallets, balance-snapshot P&L, signed CascadeReceipts, slashing-backed stake.
- 42/42 tests pass across both codebases, including adversarial tests against every flaw the review identified.
- If judges ask about V1 vs V2: V1 was a proof-of-motion; V2 is the production-tier rebuild. Both are public on the repo; we don't hide the progression.

## Post-submission flight plan

1. `cd packages/sdk && npm publish --access public` → `@beacon/sdk@1.0.0` live on npm
2. Publish `@beacon/mcp` to npm
3. Tweet thread with demo video + cascade receipt screenshot, tag `@XLayerOfficial #XLayerHackathon #onchainos`
4. Recruit 1-2 third-party signal authors per `docs/THIRD_PARTY_AUTHOR_OUTREACH.md`
5. Submit Onchain OS Plugin Store listing if Skills Arena placement requires it
