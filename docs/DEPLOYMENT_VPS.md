# Beacon — VPS Deployment (X Layer Testnet)

Target: Contabo VPS `75.119.153.252`, nginx + certbot-webroot + systemd, matching the existing `*.gudman.xyz` pattern.

## Domains

| Domain | Service | Upstream |
|---|---|---|
| `beacon.gudman.xyz` | Landing + Autopilot (static) | `/opt/beacon/app/dist` |
| `wallet-risk.gudman.xyz` | wallet-risk signal | `127.0.0.1:4001` |
| `liquidity-depth.gudman.xyz` | liquidity-depth signal | `127.0.0.1:4002` |
| `yield-score.gudman.xyz` | yield-score signal | `127.0.0.1:4003` |
| `safe-yield.gudman.xyz` | safe-yield composite | `127.0.0.1:4010` |
| `mcp.gudman.xyz` | Beacon MCP over SSE | `127.0.0.1:4100` |

## DNS (Namecheap)

Add A records for each subdomain pointing to `75.119.153.252`. Five-minute TTL is fine.

```
wallet-risk        A  75.119.153.252
liquidity-depth    A  75.119.153.252
yield-score        A  75.119.153.252
safe-yield         A  75.119.153.252
beacon             A  75.119.153.252
mcp                A  75.119.153.252
```

## Pre-deploy on local machine

1. Get 6 EOAs (one per signal operator + one payer + one deployer) — or reuse existing for demo.
2. Fund deployer EOA with testnet OKB from https://www.okx.com/xlayer/faucet.
3. Deploy contracts:
   ```bash
   cd contracts
   cp .env.example .env       # set PRIVATE_KEY (deployer)
   npm run test               # 23/23 pass
   npm run deploy:xlayer-testnet
   npm run deploy-token:xlayer-testnet
   ```
   This writes `deployments/xlayerTestnet.json` + `deployments/xlayerTestnet.testtoken.json`.
   Record the addresses:
   - `SignalRegistry`
   - `PaymentSplitter`
   - `TestToken (bUSD)`
4. Publish signals on-chain after the servers are live (step after deploy below).

## Remote bootstrap

```bash
ssh root@75.119.153.252
git clone https://github.com/Ridwannurudeen/beacon /opt/beacon
cd /opt/beacon
chmod +x deploy/*.sh
bash deploy/setup.sh   # issues certs, installs nginx configs, enables systemd units
```

## Populate .env on the VPS

For each signal directory, create `.env`. Use bUSD details from `contracts/deployments/xlayerTestnet.testtoken.json`:

```bash
ssh root@75.119.153.252
cd /opt/beacon

# wallet-risk
cat > signals/wallet-risk/.env <<EOF
CHAIN_ID=195
SIGNAL_PRIVATE_KEY=0x...WALLET_RISK_KEY...
PAY_TO=0x...WALLET_RISK_ADDR...
PRICE=1000
PORT=4001
TOKEN_ADDRESS=0x...BUSD_ADDRESS...
TOKEN_NAME=Beacon USD
TOKEN_VERSION=1
TOKEN_SYMBOL=bUSD
EOF

# Repeat pattern for liquidity-depth (PORT=4002), yield-score (PORT=4003)

# safe-yield — needs upstream URLs + upstream payTo addresses
cat > signals/safe-yield/.env <<EOF
CHAIN_ID=195
SIGNAL_PRIVATE_KEY=0x...SAFE_YIELD_KEY...
PAYER_PRIVATE_KEY=0x...SAFE_YIELD_PAYER_KEY...
PAY_TO=0x...SAFE_YIELD_ADDR...
PRICE=6000
PORT=4010
TOKEN_ADDRESS=0x...BUSD_ADDRESS...
TOKEN_NAME=Beacon USD
TOKEN_VERSION=1
TOKEN_SYMBOL=bUSD

WALLET_RISK_URL=https://wallet-risk.gudman.xyz/signal
LIQUIDITY_DEPTH_URL=https://liquidity-depth.gudman.xyz/signal
YIELD_SCORE_URL=https://yield-score.gudman.xyz/signal

WALLET_RISK_PRICE=1000
LIQUIDITY_DEPTH_PRICE=2000
YIELD_SCORE_PRICE=1500

WALLET_RISK_PAYTO=0x...WALLET_RISK_ADDR...
LIQUIDITY_DEPTH_PAYTO=0x...LIQUIDITY_DEPTH_ADDR...
YIELD_SCORE_PAYTO=0x...YIELD_SCORE_ADDR...
EOF

# MCP server
cat > packages/mcp/.env <<EOF
AGENT_PRIVATE_KEY=0x...AGENT_KEY...
BEACON_REGISTRY_URL=https://beacon.gudman.xyz/registry.json
MCP_PORT=4100
EOF
```

## Fund signal wallets with testnet OKB

Each signal wallet (wallet-risk, liquidity-depth, yield-score, safe-yield settlement + payer) needs OKB for gas. Visit https://www.okx.com/xlayer/faucet and drip to each address. Typical need: 0.01 OKB per wallet covers thousands of settlements.

Also mint bUSD to the payer wallet (composite + end-users) by calling `TestToken.mint(payerAddr, 10000000000)` — 10,000 bUSD — from any account via OKLink or a script.

## First deploy

```bash
ssh root@75.119.153.252
bash /opt/beacon/deploy/deploy.sh
```

This:
- `git fetch + reset --hard origin/main`
- `npm install` at monorepo root
- Builds SDK, MCP, all 4 signals, the Vite app
- Restarts all 5 systemd services
- Reloads nginx

## Publish signals on-chain

After the signal servers are live with HTTPS URLs:

```bash
# Locally (or on VPS with deployer key)
cd contracts
WALLET_RISK_URL=https://wallet-risk.gudman.xyz/signal \
LIQUIDITY_DEPTH_URL=https://liquidity-depth.gudman.xyz/signal \
YIELD_SCORE_URL=https://yield-score.gudman.xyz/signal \
SAFE_YIELD_URL=https://safe-yield.gudman.xyz/signal \
npm run publish:xlayer-testnet
```

Registers all 4 signals + declares safe-yield's composition on-chain.

## Generate traffic (Most Active Agent)

```bash
cd contracts
DEMO_PAYER=0x...payerAddr... ITERATIONS=500 npm run traffic:xlayer-testnet
```

Emits 2000 `CallRecorded` events.

## Subsequent deploys

```bash
# on local machine
bash deploy/push.sh
```

git push + ssh trigger.

## Verification checklist

- [ ] `curl -I https://beacon.gudman.xyz` → 200
- [ ] `curl https://wallet-risk.gudman.xyz/signal/meta` → JSON with chainId 195
- [ ] `curl https://wallet-risk.gudman.xyz/signal?address=0x...` → 402 PaymentRequired
- [ ] `systemctl status beacon-wallet-risk beacon-liquidity-depth beacon-yield-score beacon-safe-yield beacon-mcp` → all active
- [ ] OKLink testnet shows `SignalRegistered` events under SignalRegistry
- [ ] Autopilot click at https://beacon.gudman.xyz/autopilot.html → cascade populates with 4 rows
- [ ] Registry shows cumulative revenue > 0 after first real buyer flow
