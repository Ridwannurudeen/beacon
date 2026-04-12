# Beacon — Quickstart

## Prerequisites

- Node.js 20+
- An EOA private key with ~0.5 OKB on X Layer mainnet for gas
- USDT0 balance on the buyer wallet (for end-to-end testing)

## Install

```bash
git clone https://github.com/Ridwannurudeen/beacon
cd beacon
npm install
```

## Run locally (no X Layer deployment yet)

Each signal server needs its own `.env`:

```bash
cd signals/wallet-risk
cp .env.example .env
# edit .env:
#   SIGNAL_PRIVATE_KEY=0x...  (the EOA that signs settlement txs)
#   PAY_TO=0x...              (where x402 payments are credited)
#   PRICE=1000                (0.001 USDT0 per call)
#   PORT=4001
npm run dev
```

Repeat for `liquidity-depth` (port 4002), `yield-score` (port 4003), and `safe-yield` (port 4010).

Start the UI:

```bash
cd app
npm run dev  # → http://localhost:4200
```

## Deploy contracts to X Layer

```bash
cd contracts
cp .env.example .env
# edit .env: PRIVATE_KEY=0x...

npm run test                       # 23/23 pass
npm run deploy:xlayer              # writes deployments/xlayer.json
npm run publish:xlayer             # registers signals + composition on-chain
```

Verify on OKLink:

```bash
npx hardhat verify --network xlayer <SignalRegistry_address>
npx hardhat verify --network xlayer <PaymentSplitter_address>
```

## Generate demo traffic

```bash
cd contracts
ITERATIONS=500 DEMO_PAYER=0x... npm run traffic:xlayer
# emits 2000 CallRecorded events → locks Most Active Agent prize
```

## Wire Claude Desktop to Beacon MCP

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "beacon": {
      "command": "npx",
      "args": ["@beacon/mcp"],
      "env": { "AGENT_PRIVATE_KEY": "0x..." }
    }
  }
}
```

Restart Claude. The `list_signals`, `signal_meta`, `call_signal` tools will appear.

## Publishing the SDK to npm

```bash
cd packages/sdk
npm run build
npm publish --access public
```

Do the same in `packages/mcp` for `@beacon/mcp`.

## Hosting recommendations

- Signal servers: fly.io or Railway (each signal is a tiny Hono server, 1 CPU / 256 MB is plenty)
- Landing + Autopilot: Vercel / Netlify (static build)
- RPC: use https://rpc.xlayer.tech directly or configure a dedicated RPC provider via env

## Production checklist

- [ ] All 4 signal servers deployed with HTTPS URLs in production env
- [ ] Signal servers' wallets funded with OKB (gas for settlement) — ~0.05 OKB per server covers many settlements thanks to gas-subsidized USDT0 x402 on X Layer
- [ ] `SignalRegistry` + `PaymentSplitter` deployed on X Layer mainnet and verified on OKLink
- [ ] Signals registered via `npm run publish:xlayer`
- [ ] Composition declared for safe-yield
- [ ] At least 1000 `CallRecorded` events emitted (Most Active Agent bar)
- [ ] Landing page deployed, `VITE_REGISTRY_URL` pointed at production indexer
- [ ] Autopilot `VITE_SAFE_YIELD_URL` pointed at production safe-yield host
- [ ] `@beacon/sdk` + `@beacon/mcp` published to npm
- [ ] Demo video recorded per `DEMO_SCRIPT.md`
- [ ] Two Google Forms filled per `SUBMISSIONS.md`
- [ ] X post ready per `TWITTER_THREAD.md`
