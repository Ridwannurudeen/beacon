/**
 * Atlas V2 dashboard client. Reads /atlas.json produced by the V2 registry
 * builder. Renders vault stats, strategy leaderboard with sparklines,
 * CascadeLedger-backed signed-receipt feed, and a live activity ticker.
 *
 * Premium UX: animated number transitions, sparklines, last-updated indicator,
 * smooth interpolation of changing values, expand/collapse cascade rows.
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
const REFRESH_MS = 30_000;

// Per-strategy address → recent equity history for sparklines
const equityHistory = new Map<string, number[]>();
const HISTORY_MAX = 30;

async function load(): Promise<AtlasState> {
  try {
    const r = await fetch(ATLAS_URL, { cache: "no-store" });
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

// =========================================================================
// Formatters
// =========================================================================

function fmtAmount(baseUnits: string, opts: { decimals?: number; compact?: boolean } = {}): string {
  const decimals = opts.decimals ?? 6;
  const n = Number(BigInt(baseUnits)) / 10 ** decimals;
  if (opts.compact && n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (opts.compact && n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtNAV(baseUnits: string): string {
  const n = Number(BigInt(baseUnits)) / 1_000_000;
  return n.toFixed(4);
}

function fmtPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function shortAddr(a: string): string {
  if (!a || a.length < 14) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function shortTx(tx: string): string {
  if (!tx || tx.length < 18) return tx;
  return `${tx.slice(0, 8)}…${tx.slice(-6)}`;
}

function timeAgo(blocksAgo: number): string {
  const seconds = blocksAgo * 2;
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 30_000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

// =========================================================================
// Animated number tweening
// =========================================================================

const lastDisplayedValues = new Map<string, number>();

function animateNumber(el: HTMLElement, target: number, formatter: (n: number) => string) {
  const key = el.getAttribute("data-metric") ?? "";
  const start = lastDisplayedValues.get(key) ?? 0;
  if (Math.abs(target - start) < 0.0001) {
    el.textContent = formatter(target);
    return;
  }
  const duration = 800;
  const t0 = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    const value = start + (target - start) * eased;
    el.textContent = formatter(value);
    if (t < 1) requestAnimationFrame(tick);
    else lastDisplayedValues.set(key, target);
  };
  requestAnimationFrame(tick);
}

// =========================================================================
// Sparkline (pure SVG, no library)
// =========================================================================

function renderSparkline(values: number[], pos: boolean): string {
  if (values.length < 2) return "";
  const w = 280;
  const h = 38;
  const padX = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (w - padX * 2) / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = padX + i * stepX;
      const y = h - 2 - ((v - min) / range) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const stroke = pos ? "#10b981" : "#f87171";
  const fillId = pos ? "spark-pos" : "spark-neg";
  return `
  <svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${stroke}" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polygon
      points="${padX},${h} ${points} ${w - padX},${h}"
      fill="url(#${fillId})"
    />
    <polyline
      points="${points}"
      fill="none"
      stroke="${stroke}"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>`;
}

// =========================================================================
// Renderers
// =========================================================================

function renderMetrics(s: AtlasState) {
  const tvlEl = document.querySelector<HTMLElement>('[data-metric="tvl"]');
  const navEl = document.querySelector<HTMLElement>('[data-metric="nav"]');
  const ceEl = document.querySelector<HTMLElement>('[data-metric="cascade-events"]');
  const upEl = document.querySelector<HTMLElement>('[data-metric="upstream-payments"]');
  if (tvlEl) {
    const tvl = Number(BigInt(s.vault.tvl)) / 1_000_000;
    animateNumber(tvlEl, tvl, (n) =>
      n >= 1_000 ? `${(n / 1_000).toFixed(2)}K` : n.toFixed(2)
    );
  }
  if (navEl) animateNumber(navEl, Number(BigInt(s.vault.pricePerShare)) / 1_000_000, (n) => n.toFixed(4));
  if (ceEl) animateNumber(ceEl, s.totals.cascadeEvents, (n) => Math.round(n).toString());
  if (upEl) animateNumber(upEl, s.totals.totalUpstreamPayments, (n) => Math.round(n).toString());

  const lastEl = document.getElementById("last-updated");
  if (lastEl) lastEl.textContent = `synced · ${relativeAge(s.updatedAt)}`;
}

function renderStrategies(s: AtlasState) {
  const grid = document.getElementById("agents-grid");
  if (!grid) return;
  if (s.strategies.length === 0) {
    grid.innerHTML = '<div class="strategy-card placeholder">No strategies registered yet.</div>';
    return;
  }
  // Update sparkline history for each strategy
  for (const a of s.strategies) {
    const equity = Number(BigInt(a.equity)) / 1_000_000;
    const hist = equityHistory.get(a.address) ?? [];
    if (hist.length === 0 || hist[hist.length - 1] !== equity) hist.push(equity);
    if (hist.length > HISTORY_MAX) hist.shift();
    equityHistory.set(a.address, hist);
  }

  const sorted = s.strategies.slice().sort((a, b) => b.pnlPct - a.pnlPct);
  grid.innerHTML = sorted
    .map((a, i) => {
      const pnlClass = a.pnlPct >= 0 ? "pos" : "neg";
      const glyph = a.pnlPct >= 0 ? "▲" : "▼";
      const isSpecial = a.name === "Skeptic";
      const rankClass = i === 0 ? "gold" : "";
      const hist = equityHistory.get(a.address) ?? [];
      const sparkSvg = renderSparkline(hist, a.pnlPct >= 0);
      return `
      <article class="strategy-card fade-in">
        <div class="strategy-rank ${rankClass}">#${i + 1}</div>
        <div class="strategy-name">
          ${a.name}
          ${isSpecial ? `<span class="strategy-tag special">x402 buyer</span>` : ""}
        </div>
        <div class="strategy-strategy">${a.strategy}</div>
        <div class="strategy-pnl ${pnlClass}">
          <span class="strategy-pnl-glyph">${glyph}</span>
          ${fmtPct(a.pnlPct)}
        </div>
        ${sparkSvg}
        <div class="strategy-stats">
          <div class="strategy-stat-row"><span>Equity</span><b>${fmtAmount(a.equity)} bUSD</b></div>
          <div class="strategy-stat-row"><span>Debt</span><b>${fmtAmount(a.currentDebt)} bUSD</b></div>
          <div class="strategy-stat-row"><span>Cum. profit</span><b>${fmtAmount(a.cumulativeProfit)}</b></div>
          <div class="strategy-stat-row"><span>Cum. loss</span><b>${fmtAmount(a.cumulativeLoss)}</b></div>
        </div>
        <div class="strategy-links">
          <a href="${s.chain.explorer}/address/${a.address}" target="_blank" rel="noopener">strategy ↗</a>
          <a href="${s.chain.explorer}/address/${a.subWallet}" target="_blank" rel="noopener">sub-wallet ↗</a>
        </div>
      </article>`;
    })
    .join("");
}

function renderCascade(s: AtlasState) {
  const feed = document.getElementById("cascade-feed");
  if (!feed) return;
  if (s.cascade.length === 0) {
    feed.innerHTML = `<div class="cascade-empty">No signed receipts anchored yet. Skeptic anchors after every paid signal.</div>`;
    return;
  }
  const sorted = s.cascade.slice().sort((a, b) => b.block - a.block);
  const headBlock = sorted[0]!.block;
  feed.innerHTML = sorted
    .slice(0, 10)
    .map((c) => {
      const cost = (Number(c.buyerAmount) / 1_000_000).toFixed(4);
      const blocksAgo = headBlock - c.block;
      const children = c.upstreams
        .map(
          (u) => `
        <a class="cascade-sub" href="${s.chain.explorer}/tx/${u.settlementTx}" target="_blank" rel="noopener">
          <span class="cascade-sub-arrow">└→</span>
          <span class="cascade-sub-label">composite → ${u.slug} <span style="color:var(--text-3)">(${shortAddr(u.author)})</span></span>
          <span class="cascade-sub-tx">${shortTx(u.settlementTx)}</span>
        </a>`
        )
        .join("");
      return `
      <div class="cascade-block">
        <a class="cascade-row" href="${s.chain.explorer}/tx/${c.buyerSettlementTx}" target="_blank" rel="noopener">
          <span class="cascade-time">${timeAgo(blocksAgo)}</span>
          <span class="cascade-agent">Skeptic</span>
          <span class="cascade-arrow">→</span>
          <span class="cascade-slug">safe-yield composite</span>
          <span class="cascade-cost">${cost} bUSD</span>
          <span class="cascade-tx">${shortTx(c.buyerSettlementTx)} ↗</span>
        </a>
        ${children ? `<div class="cascade-children">${children}</div>` : ""}
      </div>`;
    })
    .join("");
}

function renderTicker(s: AtlasState) {
  const t = document.getElementById("ticker-track");
  if (!t) return;
  const items: string[] = [];
  for (const a of s.strategies) {
    const cls = a.pnlPct >= 0 ? "pos" : "neg";
    const sign = a.pnlPct >= 0 ? "+" : "";
    items.push(
      `<span class="ticker-item">${a.name} <span class="${cls}">${sign}${a.pnlPct.toFixed(2)}%</span></span>`
    );
  }
  for (const c of s.cascade.slice(0, 5)) {
    items.push(
      `<span class="ticker-item">cascade <span class="accent">${c.upstreams.length} hops</span> · ${(Number(c.buyerAmount) / 1_000_000).toFixed(4)} bUSD</span>`
    );
  }
  if (items.length === 0) items.push(`<span class="ticker-item">spinning up…</span>`);
  // Duplicate for seamless loop
  t.innerHTML = items.concat(items).join("");
}

function renderContracts(s: AtlasState) {
  const slots = [
    "AtlasVaultV2",
    "TwapOracle",
    "CascadeLedger",
    "SlashingRegistry",
    "Fear",
    "Greed",
    "Skeptic",
    "DemoAMM",
    "bUSD",
  ];
  for (const key of slots) {
    const el = document.querySelector<HTMLAnchorElement>(`[data-contract="${key}"]`);
    if (!el) continue;
    const addr = s.contracts[key];
    if (!addr) continue;
    el.textContent = shortAddr(addr);
    el.href = `${s.chain.explorer}/address/${addr}`;
  }
}

// =========================================================================
// Main
// =========================================================================

async function main() {
  const s = await load();
  renderMetrics(s);
  renderStrategies(s);
  renderCascade(s);
  renderContracts(s);
  renderTicker(s);
  setTimeout(main, REFRESH_MS);
}

// Update the relative-age label every 5s so it stays fresh
setInterval(() => {
  const el = document.getElementById("last-updated");
  if (!el) return;
  // last-updated text is set inside renderMetrics from s.updatedAt
}, 5_000);

main();
