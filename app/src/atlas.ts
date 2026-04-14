/**
 * Atlas V2 dashboard client. Reads /atlas.json produced by
 * build-atlasV2-registry-vps.mjs. Renders vault TVL, strategy leaderboard
 * (debt / equity / PnL), and the CascadeLedger-backed signed-receipt feed.
 */

interface UpstreamEvent {
  index: number;
  slug: string;
  author: string;
  amount: string;
  settlementTx: string;
  txHash: string;
}

interface CascadeEvent {
  receiptId: string;
  composite: string;
  buyer: string;
  buyerAmount: string;
  settlementToken: string;
  buyerSettlementTx: string;
  timestamp: string;
  block: number;
  anchorTx: string;
  upstreams: UpstreamEvent[];
}

interface StrategyEntry {
  address: string;
  name: string;
  strategy: string;
  subWallet: string;
  debtLimit: string;
  currentDebt: string;
  equity: string;
  pnlAbs: string;
  pnlPct: number;
  cumulativeProfit: string;
  cumulativeLoss: string;
}

interface AtlasState {
  version: "v2";
  chain: { id: number; name: string; explorer: string };
  contracts: Record<string, string>;
  vault: { tvl: string; totalSupply: string; pricePerShare: string; paused: boolean; guardian: string };
  amm: { spotXInBUSD: string; twap30m: string };
  strategies: StrategyEntry[];
  totals: { strategies: number; cascadeEvents: number; totalUpstreamPayments: number };
  cascade: CascadeEvent[];
  updatedAt: string;
}

const ATLAS_URL = import.meta.env.VITE_ATLAS_URL ?? "/atlas.json";

async function load(): Promise<AtlasState> {
  try {
    const r = await fetch(ATLAS_URL);
    if (!r.ok) throw new Error(`atlas ${r.status}`);
    return (await r.json()) as AtlasState;
  } catch {
    return fallback();
  }
}

function fallback(): AtlasState {
  return {
    version: "v2",
    chain: { id: 1952, name: "X Layer Testnet", explorer: "https://www.oklink.com/xlayer-test" },
    contracts: {},
    vault: { tvl: "0", totalSupply: "0", pricePerShare: "1000000", paused: false, guardian: "" },
    amm: { spotXInBUSD: "1000000000000000000", twap30m: "1000000000000000000" },
    strategies: [],
    totals: { strategies: 0, cascadeEvents: 0, totalUpstreamPayments: 0 },
    cascade: [],
    updatedAt: new Date().toISOString(),
  };
}

function fmtUSD(baseUnits: string): string {
  const n = Number(BigInt(baseUnits)) / 1_000_000;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}K`;
  return n.toFixed(2);
}

function fmtNAV(baseUnits: string): string {
  return (Number(BigInt(baseUnits)) / 1_000_000).toFixed(4);
}

function fmtPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function timeAgo(blocksAgo: number): string {
  const seconds = blocksAgo * 2;
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function renderMetrics(s: AtlasState) {
  const tvlEl = document.querySelector<HTMLElement>('[data-metric="tvl"]');
  const navEl = document.querySelector<HTMLElement>('[data-metric="nav"]');
  const tradesEl = document.querySelector<HTMLElement>('[data-metric="trades"]');
  const cascadeEl = document.querySelector<HTMLElement>('[data-metric="cascade"]');
  if (tvlEl) tvlEl.textContent = fmtUSD(s.vault.tvl);
  if (navEl) navEl.textContent = fmtNAV(s.vault.pricePerShare);
  if (tradesEl) tradesEl.textContent = s.totals.cascadeEvents.toString();
  if (cascadeEl) cascadeEl.textContent = s.totals.totalUpstreamPayments.toString();
}

function renderStrategies(s: AtlasState) {
  const grid = document.getElementById("agents-grid");
  if (!grid) return;
  if (s.strategies.length === 0) {
    grid.innerHTML = '<div class="agent-card placeholder">No strategies registered yet.</div>';
    return;
  }
  const sorted = s.strategies.slice().sort((a, b) => b.pnlPct - a.pnlPct);
  grid.innerHTML = sorted
    .map((a, i) => {
      const pnlClass = a.pnlPct >= 0 ? "pos" : "neg";
      return `
      <div class="agent-card">
        <div class="agent-rank">#${i + 1}</div>
        <div class="agent-name">${a.name}</div>
        <div class="agent-strategy">${a.strategy}</div>
        <div class="agent-pnl ${pnlClass}">${fmtPct(a.pnlPct)}</div>
        <div class="agent-stats">
          <div><span>Equity</span><b>${fmtUSD(a.equity)}</b></div>
          <div><span>Debt</span><b>${fmtUSD(a.currentDebt)}</b></div>
          <div><span>Cum. profit</span><b>${fmtUSD(a.cumulativeProfit)}</b></div>
          <div><span>Cum. loss</span><b>${fmtUSD(a.cumulativeLoss)}</b></div>
        </div>
        <a class="agent-link" href="${s.chain.explorer}/address/${a.address}" target="_blank" rel="noopener">strategy →</a>
        <a class="agent-link" href="${s.chain.explorer}/address/${a.subWallet}" target="_blank" rel="noopener">sub-wallet →</a>
      </div>`;
    })
    .join("");
}

function renderCascade(s: AtlasState) {
  const feed = document.getElementById("cascade-feed");
  if (!feed) return;
  if (s.cascade.length === 0) {
    feed.innerHTML = `<div class="cascade-empty">No signed cascade receipts anchored yet. Skeptic anchors receipts to CascadeLedger after each paid signal.</div>`;
    return;
  }
  const sorted = s.cascade.slice().sort((a, b) => b.block - a.block);
  const headBlock = sorted[0]!.block;
  feed.innerHTML = sorted
    .slice(0, 8)
    .map((c) => {
      const cost = (Number(c.buyerAmount) / 1_000_000).toFixed(4);
      const blocksAgo = headBlock - c.block;
      const children = c.upstreams
        .map(
          (u) => `
        <a class="cascade-sub" href="${s.chain.explorer}/tx/${u.settlementTx}" target="_blank" rel="noopener">
          <span class="cascade-sub-arrow">└→</span>
          <span class="cascade-sub-label">composite → ${u.slug}</span>
          <span class="cascade-sub-tx">${u.settlementTx.slice(0, 10)}…${u.settlementTx.slice(-6)}</span>
        </a>`
        )
        .join("");
      return `
        <div class="cascade-block">
          <a class="cascade-row" href="${s.chain.explorer}/tx/${c.buyerSettlementTx}" target="_blank" rel="noopener">
            <span class="cascade-time">${timeAgo(blocksAgo)}</span>
            <span class="cascade-agent">buyer</span>
            <span class="cascade-arrow">→</span>
            <span class="cascade-slug">safe-yield composite</span>
            <span class="cascade-cost">${cost} bUSD</span>
            <span class="cascade-tx">${c.buyerSettlementTx.slice(0, 10)}…${c.buyerSettlementTx.slice(-6)}</span>
          </a>
          ${children ? `<div class="cascade-children">${children}</div>` : ""}
        </div>`;
    })
    .join("");
}

function renderContracts(s: AtlasState) {
  const pairs: Array<[string, string]> = [
    ["AtlasVaultV2", "AtlasVaultV2"],
    ["TwapOracle", "TwapOracle"],
    ["CascadeLedger", "CascadeLedger"],
    ["SlashingRegistry", "SlashingRegistry"],
    ["Fear", "Fear"],
    ["Greed", "Greed"],
    ["Skeptic", "Skeptic"],
    ["DemoAMM", "DemoAMM"],
    ["bUSD", "bUSD"],
  ];
  for (const [slot, key] of pairs) {
    const el = document.querySelector<HTMLAnchorElement>(`[data-contract="${slot}"]`);
    if (!el) continue;
    const addr = s.contracts[key];
    if (!addr) continue;
    el.textContent = `${addr.slice(0, 8)}…${addr.slice(-6)}`;
    el.href = `${s.chain.explorer}/address/${addr}`;
  }
}

async function main() {
  const s = await load();
  renderMetrics(s);
  renderStrategies(s);
  renderCascade(s);
  renderContracts(s);
  setTimeout(main, 30_000);
}

main();
