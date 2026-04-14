# @beacon/subgraph

The Graph subgraph indexing the Beacon + Atlas contracts on X Layer testnet.

## Entities

- **SignalAuthor** — address-level: signals published, cumulative calls/revenue
- **Signal** — per-signal: price, url, composition, cumulative revenue
- **SignalCall** — each `CallRecorded` event
- **Agent** — on-chain trading agent registered in AgentRegistry
- **AgentTrade** — every `AgentTraded` swap
- **AgentSignalCall** — every `SignalConsumed` event
- **Vault** — AtlasVaultV2 aggregate (TVL, cumulative P&L, strategy list)
- **StrategyState** — per-strategy debt, profit, loss
- **VaultDeposit** / **VaultWithdraw** / **Harvest** — every vault lifecycle event
- **Cascade** — each EIP-712 signed CascadeReceipt landed on CascadeLedger
- **UpstreamPayment** — each fan-out within a Cascade

## Network

- `xlayer-testnet` (chainId 1952)
- Contracts indexed from block 27500000

## Deploy

```bash
cd subgraph
npm install
npm run codegen
npm run build
# Studio deploy:
graph auth <DEPLOY_KEY>
npm run deploy
```

## Queries

```graphql
# Leaderboard
{
  agents(orderBy: cumulativePnL, orderDirection: desc) {
    name
    cumulativePnL
    tradeCount
    signalCount
    cumulativeSignalSpend
  }
}

# Live cascade feed
{
  cascades(orderBy: timestamp, orderDirection: desc, first: 20) {
    composite
    buyer
    buyerAmount
    buyerSettlementTx
    upstreamPayments(orderBy: index) { slug author amount settlementTx }
  }
}

# Signal revenue leaderboard
{
  signals(orderBy: cumulativeRevenue, orderDirection: desc) {
    slug
    author { id }
    cumulativeRevenue
    callCount
  }
}
```
