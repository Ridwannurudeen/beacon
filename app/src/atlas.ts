/**
 * Atlas V2 dashboard — Tier A→D wiring:
 *   - Persistent wallet chip in nav (wallet.ts)
 *   - Live x402 demo widget (x402-browser.ts)
 *   - uPlot strategy sparklines + TVL/PPS time-series charts
 *   - 5s polling with eased number tweens
 *   - Strategy detail modal
 *   - Cascade pagination
 *   - FAQ accordion
 *   - IntersectionObserver pause for hero canvas
 *   - Status grid with signal-endpoint health checks
 *   - Toast notifications
 */
import uPlot from "uplot";
import * as wallet from "./wallet.js";
import { toast } from "./toast.js";
import { payAndCall, getBusdBalance, mintBusd, type BUSDDescriptor } from "./x402-browser.js";

interface UpstreamEvent {
  index: number; slug: string; author: string; amount: string;
  settlementTx: string; txHash: string;
}
interface CascadeEvent {
  receiptId: string; composite: string; buyer: string; buyerAmount: string;
  settlementToken: string; buyerSettlementTx: string; timestamp: string;
  block: number; anchorTx: string; upstreams: UpstreamEvent[];
}
interface StrategyEntry {
  address: string; name: string; strategy: string; subWallet: string;
  debtLimit: string; currentDebt: string; equity: string; pnlAbs: string;
  pnlPct: number; cumulativeProfit: string; cumulativeLoss: string;
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
  token?: { address: string; name: string; version: string; symbol: string; decimals: number };
  updatedAt: string;
}

const ATLAS_URL = import.meta.env.VITE_ATLAS_URL ?? "/atlas.json";
const REFRESH_MS = 5_000;
const HISTORY_MAX = 120;
const SAFE_YIELD_URL = "https://safe-yield.gudman.xyz/signal/safe-yield";

const SIGNAL_ENDPOINTS = [
  { name: "safe-yield (composite)", url: "https://safe-yield.gudman.xyz/health" },
  { name: "wallet-risk", url: "https://wallet-risk.gudman.xyz/health" },
  { name: "liquidity-depth", url: "https://liquidity-depth.gudman.xyz/health" },
  { name: "yield-score", url: "https://yield-score.gudman.xyz/health" },
  { name: "MCP server", url: "https://mcp.gudman.xyz/health" },
  { name: "atlas.json", url: "/atlas.json" },
];

const equityHistory = new Map<string, { x: number[]; y: number[] }>();
const tvlHistory: { x: number[]; y: number[] } = { x: [], y: [] };
const ppsHistory: { x: number[]; y: number[] } = { x: [], y: [] };
const lastDisplayedValues = new Map<string, number>();
const charts = new Map<string, uPlot>();
let tvlChart: uPlot | null = null;
let ppsChart: uPlot | null = null;
let modalChart: uPlot | null = null;

let cascadeSort: { col: string; dir: "asc" | "desc" } = { col: "time", dir: "desc" };
let cascadePage = 0;
const CASCADE_PAGE_SIZE = 25;
let lastState: AtlasState | null = null;
let canvasPaused = false;

// =========================================================================
// Data
// =========================================================================

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

function fmtAmount(baseUnits: string, opts: { compact?: boolean } = {}): string {
  const n = Number(BigInt(baseUnits)) / 1_000_000;
  if (opts.compact && n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (opts.compact && n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}
function fmtPct(p: number): string { return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`; }
function shortTx(t: string): string { return t && t.length > 18 ? `${t.slice(0,8)}…${t.slice(-6)}` : t; }
function timeAgo(blocksAgo: number): string {
  const s = blocksAgo * 2;
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}
function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 30_000) return "just now";
  if (ms < 60_000) return `${Math.round(ms/1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms/60_000)}m ago`;
  return `${Math.round(ms/3_600_000)}h ago`;
}

// =========================================================================
// Number tween + flash
// =========================================================================

function animateNumber(el: HTMLElement, target: number, fmt: (n: number) => string) {
  const key = el.getAttribute("data-metric") ?? el.id ?? "";
  const start = lastDisplayedValues.get(key) ?? 0;
  if (Math.abs(target - start) < 0.0001) {
    el.textContent = fmt(target);
    lastDisplayedValues.set(key, target);
    return;
  }
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
  const t0 = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - t0) / 800);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(start + (target - start) * eased);
    if (t < 1) requestAnimationFrame(tick);
    else lastDisplayedValues.set(key, target);
  };
  requestAnimationFrame(tick);
}

// =========================================================================
// uPlot helpers
// =========================================================================

function makeSparkline(container: HTMLElement, h: { x: number[]; y: number[] }, pos: boolean): uPlot | null {
  if (h.x.length < 2) return null;
  const stroke = pos ? "#34d399" : "#f87171";
  const fill = pos ? "rgba(52,211,153,0.18)" : "rgba(248,113,113,0.18)";
  return new uPlot({
    width: container.clientWidth || 280,
    height: 80,
    pxAlign: false,
    cursor: { drag: { x: false, y: false }, points: { size: 5, fill: stroke } },
    select: { show: false } as unknown as uPlot.Options["select"],
    legend: { show: false },
    scales: { x: { time: false }, y: { auto: true } },
    axes: [{ show: false }, { show: false }],
    series: [{}, { stroke, width: 1.6, fill, points: { show: false } }],
  }, [h.x, h.y], container);
}

function makeAreaChart(container: HTMLElement, h: { x: number[]; y: number[] }, color: string): uPlot | null {
  if (h.x.length < 2) return null;
  return new uPlot({
    width: container.clientWidth || 600,
    height: 220,
    pxAlign: false,
    cursor: { points: { size: 6, fill: color } },
    legend: { show: false },
    scales: { x: { time: true }, y: { auto: true } },
    axes: [
      { stroke: "#9ca3af", grid: { stroke: "rgba(255,255,255,0.05)" } },
      { stroke: "#9ca3af", grid: { stroke: "rgba(255,255,255,0.05)" } },
    ],
    series: [
      {},
      { stroke: color, width: 2, fill: color.replace("rgb", "rgba").replace(")", ",0.15)"), points: { show: false } },
    ],
  }, [h.x, h.y], container);
}

// =========================================================================
// Renderers
// =========================================================================

function pushHistory(h: { x: number[]; y: number[] }, x: number, y: number) {
  if (h.y.length === 0 || h.y[h.y.length - 1] !== y || x - (h.x[h.x.length - 1] ?? 0) > 30_000) {
    h.x.push(x);
    h.y.push(y);
  }
  while (h.x.length > HISTORY_MAX) { h.x.shift(); h.y.shift(); }
}

function renderMetrics(s: AtlasState) {
  const tvl = Number(BigInt(s.vault.tvl)) / 1_000_000;
  const pps = Number(BigInt(s.vault.pricePerShare)) / 1_000_000;
  const now = Date.now() / 1000;
  pushHistory(tvlHistory, now, tvl);
  pushHistory(ppsHistory, now, pps);

  const set = (sel: string, v: number, fmt: (n: number) => string) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) animateNumber(el, v, fmt);
  };
  set('[data-metric="tvl"]', tvl, (n) => n >= 1000 ? `${(n/1000).toFixed(2)}K` : n.toFixed(2));
  set('[data-metric="nav"]', pps, (n) => n.toFixed(4));
  set('[data-metric="cascade-events"]', s.totals.cascadeEvents, (n) => Math.round(n).toString());
  set('[data-metric="upstream-payments"]', s.totals.totalUpstreamPayments, (n) => Math.round(n).toString());

  const lastEl = document.getElementById("last-updated");
  if (lastEl) lastEl.textContent = `synced · ${relativeAge(s.updatedAt)}`;
  const ts = document.getElementById("tab-count-strategies");
  if (ts) ts.textContent = String(s.totals.strategies);
  const tc = document.getElementById("tab-count-cascades");
  if (tc) tc.textContent = String(s.totals.cascadeEvents);
  const fa = document.getElementById("filter-count-all");
  if (fa) fa.textContent = String(s.cascade.length);
  const cc = document.getElementById("cascade-count");
  if (cc) cc.textContent = String(s.cascade.length);
  const hc = document.getElementById("hero-canvas-counter");
  if (hc) hc.textContent = `${s.totals.cascadeEvents} receipts · ${s.totals.totalUpstreamPayments} hops`;
}

function renderVaultCharts(s: AtlasState) {
  const tvl = Number(BigInt(s.vault.tvl)) / 1_000_000;
  const pps = Number(BigInt(s.vault.pricePerShare)) / 1_000_000;
  const tvlVal = document.getElementById("chart-tvl-value");
  if (tvlVal) tvlVal.textContent = `${tvl >= 1000 ? (tvl/1000).toFixed(2) + "K" : tvl.toFixed(2)} bUSD`;
  const ppsVal = document.getElementById("chart-pps-value");
  if (ppsVal) ppsVal.textContent = pps.toFixed(6);

  const tvlEl = document.getElementById("chart-tvl");
  if (tvlEl && tvlHistory.x.length >= 2) {
    if (tvlChart) tvlChart.destroy();
    tvlEl.innerHTML = "";
    tvlChart = makeAreaChart(tvlEl, tvlHistory, "rgb(96,165,250)");
  }
  const ppsEl = document.getElementById("chart-pps");
  if (ppsEl && ppsHistory.x.length >= 2) {
    if (ppsChart) ppsChart.destroy();
    ppsEl.innerHTML = "";
    ppsChart = makeAreaChart(ppsEl, ppsHistory, "rgb(52,211,153)");
  }

  const setText = (id: string, t: string) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  setText("vault-supply", `${fmtAmount(s.vault.totalSupply, { compact: true })} ATLS`);
  setText("vault-status", s.vault.paused ? "PAUSED" : "Active");
  setText("amm-spot", (Number(BigInt(s.amm.spotXInBUSD)) / 1e18).toFixed(6));
  setText("amm-twap", (Number(BigInt(s.amm.twap30m)) / 1e18).toFixed(6));
}

function renderStrategies(s: AtlasState) {
  const grid = document.getElementById("agents-grid");
  if (!grid) return;
  if (s.strategies.length === 0) {
    grid.innerHTML = '<div class="strategy-card placeholder">No strategies registered yet.</div>';
    return;
  }
  const now = Date.now();
  for (const a of s.strategies) {
    const eq = Number(BigInt(a.equity)) / 1_000_000;
    const h = equityHistory.get(a.address) ?? { x: [], y: [] };
    pushHistory(h, now, eq);
    equityHistory.set(a.address, h);
  }

  const sorted = s.strategies.slice().sort((a, b) => b.pnlPct - a.pnlPct);
  grid.innerHTML = sorted.map((a, i) => {
    const cls = a.pnlPct >= 0 ? "pos" : "neg";
    const glyph = a.pnlPct >= 0 ? "▲" : "▼";
    const isSpecial = a.name === "Skeptic";
    return `
      <article class="strategy-card fade-in" data-addr="${a.address}">
        <div class="strategy-rank ${i === 0 ? "gold" : ""}">#${i + 1}</div>
        <div class="strategy-name">${a.name}${isSpecial ? `<span class="strategy-tag special">x402 buyer</span>` : ""}</div>
        <div class="strategy-strategy">${a.strategy}</div>
        <div class="strategy-pnl ${cls}"><span class="strategy-pnl-glyph">${glyph}</span>${fmtPct(a.pnlPct)}</div>
        <div class="strategy-chart" data-chart="${a.address}"></div>
        <div class="strategy-stats">
          <div class="strategy-stat-row"><span>Equity</span><b>${fmtAmount(a.equity)}</b></div>
          <div class="strategy-stat-row"><span>Debt</span><b>${fmtAmount(a.currentDebt)}</b></div>
          <div class="strategy-stat-row"><span>Profit</span><b style="color:var(--pos)">${fmtAmount(a.cumulativeProfit)}</b></div>
          <div class="strategy-stat-row"><span>Loss</span><b style="color:var(--neg)">${fmtAmount(a.cumulativeLoss)}</b></div>
        </div>
        <div class="strategy-links">
          <a href="${s.chain.explorer}/address/${a.address}" target="_blank" rel="noopener" onclick="event.stopPropagation()">strategy ↗</a>
          <a href="${s.chain.explorer}/address/${a.subWallet}" target="_blank" rel="noopener" onclick="event.stopPropagation()">sub-wallet ↗</a>
        </div>
      </article>`;
  }).join("");

  for (const a of sorted) {
    const c = grid.querySelector<HTMLElement>(`[data-chart="${a.address}"]`);
    if (!c) continue;
    const h = equityHistory.get(a.address);
    if (!h || h.x.length < 2) continue;
    const old = charts.get(a.address);
    if (old) old.destroy();
    const ch = makeSparkline(c, { x: h.x.map((x) => x / 1000), y: h.y }, a.pnlPct >= 0);
    if (ch) charts.set(a.address, ch);
  }

  grid.querySelectorAll<HTMLElement>(".strategy-card[data-addr]").forEach((card) => {
    card.addEventListener("click", () => {
      const addr = card.getAttribute("data-addr");
      const strat = s.strategies.find((x) => x.address === addr);
      if (strat) openStrategyModal(strat, s);
    });
  });
}

// =========================================================================
// Cascade table + pagination
// =========================================================================

const expandedRows = new Set<string>();

function renderCascadeTable(s: AtlasState) {
  const tbody = document.getElementById("cascade-tbody");
  if (!tbody) return;
  let rows = s.cascade.slice();
  rows.sort((a, b) => {
    const dir = cascadeSort.dir === "asc" ? 1 : -1;
    switch (cascadeSort.col) {
      case "time":
      case "block": return (a.block - b.block) * dir;
      case "buyer": return a.buyer.localeCompare(b.buyer) * dir;
      case "hops": return (a.upstreams.length - b.upstreams.length) * dir;
      case "cost": return (Number(BigInt(a.buyerAmount)) - Number(BigInt(b.buyerAmount))) * dir;
      case "tx": return a.buyerSettlementTx.localeCompare(b.buyerSettlementTx) * dir;
      default: return 0;
    }
  });

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><div class="empty-icon">⏳</div>Waiting for Skeptic to anchor a cascade receipt…</td></tr>`;
    const pag = document.getElementById("cascade-pagination");
    if (pag) pag.style.display = "none";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / CASCADE_PAGE_SIZE));
  if (cascadePage >= totalPages) cascadePage = totalPages - 1;
  const start = cascadePage * CASCADE_PAGE_SIZE;
  const pageRows = rows.slice(start, start + CASCADE_PAGE_SIZE);
  const headBlock = Math.max(...s.cascade.map((c) => c.block), 0);

  tbody.innerHTML = pageRows.map((c) => {
    const cost = (Number(c.buyerAmount) / 1_000_000).toFixed(4);
    const exp = expandedRows.has(c.receiptId);
    const detail = exp ? `
      <tr class="detail">
        <td colspan="6">
          <div class="upstream-list">
            ${c.upstreams.map((u) => `
              <a class="upstream-row" href="${s.chain.explorer}/tx/${u.settlementTx}" target="_blank" rel="noopener">
                <span class="arrow">└→</span>
                <span>${u.slug} <span style="color:var(--text-3)">(${wallet.shortAddr(u.author)})</span></span>
                <span class="amount">${(Number(u.amount) / 1_000_000).toFixed(4)} bUSD</span>
                <span>${shortTx(u.settlementTx)} ↗</span>
              </a>`).join("")}
          </div>
        </td>
      </tr>` : "";
    return `
      <tr data-id="${c.receiptId}" class="${exp ? "expanded" : ""}">
        <td class="col-time">${timeAgo(headBlock - c.block)}</td>
        <td class="col-buyer">Skeptic</td>
        <td>safe-yield</td>
        <td class="col-hops"><span class="pill">${c.upstreams.length} hops</span></td>
        <td class="col-cost">${cost} bUSD</td>
        <td class="col-tx">${shortTx(c.buyerSettlementTx)} ${exp ? "▾" : "▸"}</td>
      </tr>${detail}`;
  }).join("");

  document.querySelectorAll<HTMLElement>(".cascade-table thead th").forEach((th) => {
    const c = th.getAttribute("data-sort");
    th.classList.toggle("sorted", c === cascadeSort.col);
    const ind = th.querySelector(".sort-indicator");
    if (ind) ind.textContent = c === cascadeSort.col ? (cascadeSort.dir === "asc" ? "↑" : "↓") : "";
  });

  tbody.querySelectorAll<HTMLElement>("tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).tagName === "A") return;
      const id = tr.getAttribute("data-id") ?? "";
      if (expandedRows.has(id)) expandedRows.delete(id);
      else expandedRows.add(id);
      if (lastState) renderCascadeTable(lastState);
    });
  });

  const pag = document.getElementById("cascade-pagination");
  const info = document.getElementById("cascade-page-info");
  const prev = document.getElementById("cascade-prev") as HTMLButtonElement | null;
  const next = document.getElementById("cascade-next") as HTMLButtonElement | null;
  if (pag) pag.style.display = totalPages > 1 ? "flex" : "none";
  if (info) info.textContent = `Page ${cascadePage + 1} of ${totalPages} · ${rows.length} receipts`;
  if (prev) prev.disabled = cascadePage === 0;
  if (next) next.disabled = cascadePage >= totalPages - 1;
}

function renderContracts(s: AtlasState) {
  for (const key of ["AtlasVaultV2", "TwapOracle", "CascadeLedger", "SlashingRegistry", "Fear", "Greed", "Skeptic", "DemoAMM", "bUSD"]) {
    const el = document.querySelector<HTMLAnchorElement>(`[data-contract="${key}"]`);
    if (!el) continue;
    const addr = s.contracts[key];
    if (!addr) continue;
    el.textContent = wallet.shortAddr(addr);
    el.href = `${s.chain.explorer}/address/${addr}`;
  }
}

// =========================================================================
// Strategy detail modal
// =========================================================================

function openStrategyModal(a: StrategyEntry, s: AtlasState) {
  const modal = document.getElementById("strategy-modal");
  if (!modal) return;
  const title = document.getElementById("strategy-modal-title");
  const sub = document.getElementById("strategy-modal-sub");
  const stats = document.getElementById("strategy-modal-stats");
  const extra = document.getElementById("strategy-modal-extra");
  const chartEl = document.getElementById("strategy-modal-chart");
  if (title) title.textContent = a.name;
  if (sub) sub.textContent = `${a.strategy} · ${wallet.shortAddr(a.address)}`;
  if (stats) {
    stats.innerHTML = `
      <div><span>Equity</span><b>${fmtAmount(a.equity)} bUSD</b></div>
      <div><span>Debt</span><b>${fmtAmount(a.currentDebt)} bUSD</b></div>
      <div><span>PnL</span><b class="${a.pnlPct >= 0 ? "pos" : "neg"}">${fmtPct(a.pnlPct)}</b></div>
      <div><span>Profit</span><b style="color:var(--pos)">${fmtAmount(a.cumulativeProfit)}</b></div>
      <div><span>Loss</span><b style="color:var(--neg)">${fmtAmount(a.cumulativeLoss)}</b></div>
      <div><span>Debt Limit</span><b>${fmtAmount(a.debtLimit, { compact: true })}</b></div>`;
  }
  if (extra) {
    extra.innerHTML = `
      <h4>On-chain</h4>
      <div style="display:flex; gap:12px; flex-wrap:wrap; font-size:13px;">
        <a href="${s.chain.explorer}/address/${a.address}" target="_blank" rel="noopener">strategy contract ↗</a>
        <a href="${s.chain.explorer}/address/${a.subWallet}" target="_blank" rel="noopener">sub-wallet ↗</a>
      </div>`;
  }
  if (chartEl) {
    chartEl.innerHTML = "";
    if (modalChart) { modalChart.destroy(); modalChart = null; }
    const h = equityHistory.get(a.address);
    if (h && h.x.length >= 2) {
      modalChart = makeAreaChart(chartEl, { x: h.x.map((x) => x / 1000), y: h.y }, a.pnlPct >= 0 ? "rgb(52,211,153)" : "rgb(248,113,113)");
    } else {
      chartEl.innerHTML = '<div class="dim" style="padding:40px; text-align:center;">Collecting data… check back in a few cycles.</div>';
    }
  }
  modal.classList.add("open");
}

function initModal() {
  const modal = document.getElementById("strategy-modal");
  if (!modal) return;
  const close = () => {
    modal.classList.remove("open");
    if (modalChart) { modalChart.destroy(); modalChart = null; }
  };
  document.getElementById("strategy-modal-close")?.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

// =========================================================================
// Tabs, filters, pagination, FAQ, drawer
// =========================================================================

function initTabs() {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-tab");
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll<HTMLElement>(".tab-panel").forEach((p) => {
        p.classList.toggle("active", p.getAttribute("data-panel") === target);
      });
      if (lastState) {
        if (target === "strategies") renderStrategies(lastState);
        if (target === "vault") renderVaultCharts(lastState);
      }
    });
  });

  document.querySelectorAll<HTMLElement>(".cascade-table thead th").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-sort") ?? "time";
      if (cascadeSort.col === col) cascadeSort.dir = cascadeSort.dir === "asc" ? "desc" : "asc";
      else cascadeSort = { col, dir: "desc" };
      if (lastState) renderCascadeTable(lastState);
    });
  });

  document.getElementById("cascade-prev")?.addEventListener("click", () => {
    if (cascadePage > 0) { cascadePage--; if (lastState) renderCascadeTable(lastState); }
  });
  document.getElementById("cascade-next")?.addEventListener("click", () => {
    cascadePage++; if (lastState) renderCascadeTable(lastState);
  });
}

function initFAQ() {
  document.querySelectorAll<HTMLElement>(".faq-item").forEach((item) => {
    const q = item.querySelector(".faq-q");
    if (!q) return;
    q.addEventListener("click", () => item.classList.toggle("open"));
  });
}

function initMobileDrawer() {
  const toggle = document.getElementById("menu-toggle");
  const drawer = document.getElementById("mobile-drawer");
  if (!toggle || !drawer) return;
  toggle.addEventListener("click", () => drawer.classList.toggle("open"));
  drawer.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => drawer.classList.remove("open")));
}

// =========================================================================
// Wallet chip
// =========================================================================

function renderWalletChip() {
  const slot = document.getElementById("wallet-slot");
  if (!slot) return;
  const state = wallet.getState();
  if (!state.address) {
    slot.innerHTML = `<button class="btn sm" id="wallet-connect-btn">Connect</button>`;
    document.getElementById("wallet-connect-btn")?.addEventListener("click", async () => {
      const a = await wallet.connectWallet();
      if (a) toast(`Connected ${wallet.shortAddr(a)}`, { kind: "success" });
    });
    return;
  }
  slot.innerHTML = `<span class="wallet-chip" title="${state.address}">
    <span class="wallet-chip-avatar"></span>
    <span class="wallet-chip-addr">${wallet.shortAddr(state.address)}</span>
    <button class="wallet-chip-disconnect" aria-label="Disconnect">×</button>
  </span>`;
  slot.querySelector(".wallet-chip-disconnect")?.addEventListener("click", () => {
    wallet.disconnectWallet();
    toast("Wallet disconnected", { kind: "info" });
  });
}

// =========================================================================
// Demo widget
// =========================================================================

async function refreshDemoWalletInfo() {
  const state = wallet.getState();
  const w = document.getElementById("demo-wallet");
  const b = document.getElementById("demo-balance");
  if (w) w.textContent = state.address ? wallet.shortAddr(state.address) : "not connected";
  if (b) {
    if (!state.address || !lastState?.contracts.bUSD) { b.textContent = "—"; return; }
    try {
      const bal = await getBusdBalance(state.address, lastState.contracts.bUSD);
      b.textContent = `${(Number(bal) / 1_000_000).toFixed(4)} bUSD`;
    } catch { b.textContent = "—"; }
  }
}

function initDemoWidget() {
  const callBtn = document.getElementById("demo-call") as HTMLButtonElement | null;
  const mintBtn = document.getElementById("demo-mint") as HTMLButtonElement | null;
  const out = document.getElementById("demo-output");
  if (!callBtn || !mintBtn || !out) return;

  callBtn.addEventListener("click", async () => {
    const state = wallet.getState();
    if (!state.address) { toast("Connect a wallet first", { kind: "error" }); return; }
    if (!lastState?.token) { toast("Atlas registry not loaded", { kind: "error" }); return; }
    callBtn.disabled = true;
    out.innerHTML = `<span class="dim">Probing endpoint, then signing EIP-3009 authorization…</span>`;
    const dismiss = toast("Calling safe-yield…", { kind: "pending" });
    try {
      const desc: BUSDDescriptor = {
        address: lastState.token.address,
        name: lastState.token.name,
        version: lastState.token.version,
        symbol: lastState.token.symbol,
        decimals: lastState.token.decimals,
      };
      const res = await payAndCall(SAFE_YIELD_URL, state.address, desc, lastState.chain.id);
      dismiss();
      const exp = lastState.chain.explorer;
      const upstreams = res.cascadeReceipt?.upstreams ?? [];
      out.innerHTML = `
        <div class="ok">${res.status} OK</div>
        <pre style="margin:8px 0 12px; white-space:pre-wrap; font-size:11px; line-height:1.5;">${escapeHtml(JSON.stringify(res.body, null, 2)).slice(0, 600)}</pre>
        ${res.paymentTx ? `<div>buyer settlement: <a href="${exp}/tx/${res.paymentTx}" target="_blank">${shortTx(res.paymentTx)} ↗</a></div>` : ""}
        ${res.cascadeReceipt ? `<div style="margin-top:10px;">composite: <span class="mono">${shortTx(res.cascadeReceipt.composite)}</span></div>
        <div style="margin-top:6px;"><b>${upstreams.length}</b> upstream payments:</div>
        <div class="upstream-list" style="margin-top:6px;">
          ${upstreams.map((u) => `<a class="upstream-row" href="${exp}/tx/${u.settlementTx}" target="_blank" rel="noopener">
            <span class="arrow">└→</span><span>${u.slug}</span>
            <span class="amount">${(Number(u.amount) / 1_000_000).toFixed(4)} bUSD</span>
            <span>${shortTx(u.settlementTx)} ↗</span></a>`).join("")}
        </div>` : ""}`;
      toast(`Signal returned · ${upstreams.length} cascade hops`, {
        kind: "success",
        action: res.paymentTx ? { label: "view tx", href: `${exp}/tx/${res.paymentTx}` } : undefined,
      });
      refreshDemoWalletInfo();
    } catch (e) {
      dismiss();
      const msg = (e as Error).message;
      out.innerHTML = `<span style="color:var(--neg)">error</span>\n${escapeHtml(msg)}`;
      toast(`Call failed: ${msg}`, { kind: "error" });
    } finally {
      callBtn.disabled = false;
    }
  });

  mintBtn.addEventListener("click", async () => {
    const state = wallet.getState();
    if (!state.address) { toast("Connect a wallet first", { kind: "error" }); return; }
    if (!lastState?.contracts.bUSD) { toast("bUSD address not loaded", { kind: "error" }); return; }
    mintBtn.disabled = true;
    const dismiss = toast("Minting 1 bUSD…", { kind: "pending" });
    try {
      const tx = await mintBusd(state.address, 1_000_000n, lastState.contracts.bUSD);
      dismiss();
      toast("1 bUSD minted", {
        kind: "success",
        action: { label: "view tx", href: `${lastState.chain.explorer}/tx/${tx}` },
      });
      setTimeout(refreshDemoWalletInfo, 4000);
    } catch (e) {
      dismiss();
      toast(`Mint failed: ${(e as Error).message}`, { kind: "error" });
    } finally {
      mintBtn.disabled = false;
    }
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// =========================================================================
// Status grid
// =========================================================================

async function renderStatus() {
  const grid = document.getElementById("status-grid");
  const upd = document.getElementById("status-updated");
  if (!grid) return;
  grid.innerHTML = SIGNAL_ENDPOINTS.map((s) => `
    <div class="status-item" data-name="${s.name}">
      <div class="status-item-name">${s.name}<span>${s.url.replace(/^https?:\/\//, "")}</span></div>
      <div class="status-item-state"><span class="status-dot status-dot-yellow"></span><span>checking…</span></div>
    </div>`).join("");

  const checks = SIGNAL_ENDPOINTS.map(async (s) => {
    const el = grid.querySelector<HTMLElement>(`[data-name="${s.name}"] .status-item-state`);
    const t0 = performance.now();
    try {
      const r = await fetch(s.url, { cache: "no-store", method: "GET" });
      const ms = Math.round(performance.now() - t0);
      const ok = r.ok;
      if (el) el.innerHTML = `<span class="status-dot ${ok ? "" : "status-dot-red"}"></span><span>${ok ? "up" : `${r.status}`} · ${ms}ms</span>`;
    } catch {
      if (el) el.innerHTML = `<span class="status-dot status-dot-red"></span><span>down</span>`;
    }
  });
  await Promise.all(checks);
  if (upd) upd.textContent = `last check · ${new Date().toLocaleTimeString()}`;
}

// =========================================================================
// Hero canvas (with IntersectionObserver pause)
// =========================================================================

interface Particle { fromX: number; fromY: number; toX: number; toY: number; t: number; speed: number; color: string; size: number; }

function initHeroCanvas() {
  const canvas = document.getElementById("hero-canvas") as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  };
  resize();
  window.addEventListener("resize", resize);

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) canvasPaused = !e.isIntersecting;
  }, { threshold: 0.01 });
  io.observe(canvas);

  const getLayout = () => {
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    return {
      buyer: { x: w * 0.18, y: h * 0.5 },
      composite: { x: w * 0.5, y: h * 0.5 },
      upstreams: [
        { x: w * 0.85, y: h * 0.22, label: "wallet-risk" },
        { x: w * 0.85, y: h * 0.5, label: "liquidity-depth" },
        { x: w * 0.85, y: h * 0.78, label: "yield-score" },
      ],
    };
  };

  const particles: Particle[] = [];
  const pulses: Array<{ x: number; y: number; r: number; alpha: number; color: string }> = [];
  let lastEmit = 0;
  const EMIT_INTERVAL = 2200;

  function emitCascade() {
    const L = getLayout();
    particles.push({ fromX: L.buyer.x, fromY: L.buyer.y, toX: L.composite.x, toY: L.composite.y, t: 0, speed: 0.012, color: "rgba(52, 211, 153, ", size: 4 });
    pulses.push({ x: L.buyer.x, y: L.buyer.y, r: 6, alpha: 0.8, color: "52, 211, 153" });
    setTimeout(() => {
      const L2 = getLayout();
      const colors = ["167, 139, 250", "96, 165, 250", "167, 139, 250"];
      L2.upstreams.forEach((up, i) => {
        particles.push({ fromX: L2.composite.x, fromY: L2.composite.y, toX: up.x, toY: up.y, t: 0, speed: 0.015, color: `rgba(${colors[i]}, `, size: 3.5 });
      });
      pulses.push({ x: L2.composite.x, y: L2.composite.y, r: 6, alpha: 0.8, color: "96, 165, 250" });
    }, 700);
  }

  function drawNode(x: number, y: number, label: string, color: string, size = 14) {
    const g = ctx!.createRadialGradient(x, y, 0, x, y, size * 2.5);
    g.addColorStop(0, `rgba(${color}, 0.4)`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    ctx!.fillStyle = g;
    ctx!.beginPath(); ctx!.arc(x, y, size * 2.5, 0, Math.PI * 2); ctx!.fill();
    ctx!.fillStyle = `rgb(${color})`;
    ctx!.beginPath(); ctx!.arc(x, y, size / 3, 0, Math.PI * 2); ctx!.fill();
    ctx!.strokeStyle = `rgba(${color}, 0.6)`; ctx!.lineWidth = 1;
    ctx!.beginPath(); ctx!.arc(x, y, size, 0, Math.PI * 2); ctx!.stroke();
    ctx!.fillStyle = "rgba(180, 182, 196, 0.7)";
    ctx!.font = '10px "Geist Mono", monospace';
    ctx!.textAlign = "center";
    ctx!.fillText(label, x, y + size + 14);
  }

  function drawConnection(fromX: number, fromY: number, toX: number, toY: number, color: string, alpha: number) {
    ctx!.strokeStyle = `rgba(${color}, ${alpha})`; ctx!.lineWidth = 1;
    ctx!.beginPath();
    const cx = (fromX + toX) / 2;
    const cy = (fromY + toY) / 2 - Math.abs(toX - fromX) * 0.05;
    ctx!.moveTo(fromX, fromY);
    ctx!.quadraticCurveTo(cx, cy, toX, toY);
    ctx!.stroke();
  }

  function frame(now: number) {
    if (canvasPaused) { requestAnimationFrame(frame); return; }
    if (!ctx) return;
    const w = canvas!.getBoundingClientRect().width;
    const h = canvas!.getBoundingClientRect().height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255, 255, 255, 0.025)";
    for (let x = 20; x < w; x += 24) for (let y = 20; y < h; y += 24) {
      ctx.beginPath(); ctx.arc(x, y, 0.5, 0, Math.PI * 2); ctx.fill();
    }
    const L = getLayout();
    drawConnection(L.buyer.x, L.buyer.y, L.composite.x, L.composite.y, "52, 211, 153", 0.15);
    L.upstreams.forEach((up) => drawConnection(L.composite.x, L.composite.y, up.x, up.y, "167, 139, 250", 0.15));
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i]!;
      ctx.strokeStyle = `rgba(${p.color}, ${p.alpha})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
      p.r += 1.4; p.alpha -= 0.025;
      if (p.alpha <= 0) pulses.splice(i, 1);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.t += p.speed;
      const trail = 5;
      for (let k = 0; k < trail; k++) {
        const tk = Math.max(0, p.t - k * 0.04);
        const tx = p.fromX + (p.toX - p.fromX) * tk;
        const ty = p.fromY + (p.toY - p.fromY) * tk;
        const alpha = (1 - k / trail) * 0.8;
        ctx.fillStyle = p.color + alpha + ")";
        ctx.beginPath(); ctx.arc(tx, ty, p.size * (1 - k / trail / 2), 0, Math.PI * 2); ctx.fill();
      }
      if (p.t >= 1) {
        const c = p.color.replace("rgba(", "").replace(", ", "").split(",").slice(0, 3).join(",");
        pulses.push({ x: p.toX, y: p.toY, r: 4, alpha: 0.8, color: c });
        particles.splice(i, 1);
      }
    }
    drawNode(L.buyer.x, L.buyer.y, "Skeptic", "52, 211, 153", 14);
    drawNode(L.composite.x, L.composite.y, "safe-yield", "96, 165, 250", 18);
    L.upstreams.forEach((up) => drawNode(up.x, up.y, up.label, "167, 139, 250", 12));
    if (now - lastEmit > EMIT_INTERVAL) { emitCascade(); lastEmit = now; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// =========================================================================
// Main
// =========================================================================

let firstLoad = true;

async function tick() {
  const s = await load();
  const prevReceipts = lastState?.totals.cascadeEvents ?? -1;
  lastState = s;
  renderMetrics(s);
  renderStrategies(s);
  renderCascadeTable(s);
  renderVaultCharts(s);
  renderContracts(s);
  refreshDemoWalletInfo();
  if (!firstLoad && s.totals.cascadeEvents > prevReceipts) {
    toast(`+${s.totals.cascadeEvents - prevReceipts} new cascade receipt${s.totals.cascadeEvents - prevReceipts > 1 ? "s" : ""}`, { kind: "info" });
  }
  firstLoad = false;
  setTimeout(tick, REFRESH_MS);
}

wallet.init();
wallet.onChange(() => { renderWalletChip(); refreshDemoWalletInfo(); });
initTabs();
initFAQ();
initModal();
initMobileDrawer();
initHeroCanvas();
initDemoWidget();
renderStatus();
setInterval(renderStatus, 60_000);
tick();

setInterval(() => {
  if (!lastState) return;
  const lastEl = document.getElementById("last-updated");
  if (lastEl) lastEl.textContent = `synced · ${relativeAge(lastState.updatedAt)}`;
}, 5_000);
