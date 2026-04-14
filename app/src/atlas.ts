/**
 * Atlas V2 dashboard — top-tier UX:
 *   - Animated WebGL-style canvas hero showing the live cascade flow
 *   - uPlot interactive sparklines per strategy
 *   - Tabbed dashboard (Strategies / Cascades / Vault / Contracts)
 *   - Sortable + filterable cascade table with expand/collapse rows
 *   - Skeleton loaders that match real component shape
 *   - Number flash on data refresh
 *   - Mobile drawer
 */
import uPlot from "uplot";

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
const HISTORY_MAX = 60;

const equityHistory = new Map<string, { x: number[]; y: number[] }>();
const lastDisplayedValues = new Map<string, number>();
const charts = new Map<string, uPlot>();
let cascadeSort: { col: string; dir: "asc" | "desc" } = { col: "time", dir: "desc" };
let cascadeFilter = "all";
let lastState: AtlasState | null = null;

// =========================================================================
// Data load
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
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(2);
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
// Animated number tweening + flash on change
// =========================================================================

function animateNumber(el: HTMLElement, target: number, formatter: (n: number) => string) {
  const key = el.getAttribute("data-metric") ?? el.id ?? "";
  const start = lastDisplayedValues.get(key) ?? 0;
  if (Math.abs(target - start) < 0.0001) {
    el.textContent = formatter(target);
    return;
  }
  el.classList.remove("flash");
  void el.offsetWidth; // force reflow
  el.classList.add("flash");
  const duration = 800;
  const t0 = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = start + (target - start) * eased;
    el.textContent = formatter(value);
    if (t < 1) requestAnimationFrame(tick);
    else lastDisplayedValues.set(key, target);
  };
  requestAnimationFrame(tick);
}

// =========================================================================
// uPlot strategy chart
// =========================================================================

function makeStrategyChart(container: HTMLElement, history: { x: number[]; y: number[] }, pos: boolean) {
  if (history.x.length < 2) return;
  const stroke = pos ? "#34d399" : "#f87171";
  const fill = pos ? "rgba(52, 211, 153, 0.18)" : "rgba(248, 113, 113, 0.18)";
  const opts: uPlot.Options = {
    width: container.clientWidth || 280,
    height: 80,
    pxAlign: false,
    cursor: { drag: { x: false, y: false }, points: { size: 5, fill: stroke } },
    select: { show: false } as unknown as uPlot.Options["select"],
    legend: { show: false },
    scales: { x: { time: false }, y: { auto: true } },
    axes: [
      { show: false },
      { show: false },
    ],
    series: [
      {},
      {
        stroke,
        width: 1.6,
        fill,
        points: { show: false },
      },
    ],
  };
  return new uPlot(opts, [history.x, history.y], container);
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
    animateNumber(tvlEl, tvl, (n) => (n >= 1_000 ? `${(n / 1_000).toFixed(2)}K` : n.toFixed(2)));
  }
  if (navEl) animateNumber(navEl, Number(BigInt(s.vault.pricePerShare)) / 1_000_000, (n) => n.toFixed(4));
  if (ceEl) animateNumber(ceEl, s.totals.cascadeEvents, (n) => Math.round(n).toString());
  if (upEl) animateNumber(upEl, s.totals.totalUpstreamPayments, (n) => Math.round(n).toString());

  const lastEl = document.getElementById("last-updated");
  if (lastEl) lastEl.textContent = `synced · ${relativeAge(s.updatedAt)}`;

  const tabCascadesCount = document.getElementById("tab-count-cascades");
  if (tabCascadesCount) tabCascadesCount.textContent = String(s.totals.cascadeEvents);
  const tabStrategiesCount = document.getElementById("tab-count-strategies");
  if (tabStrategiesCount) tabStrategiesCount.textContent = String(s.totals.strategies);
  const filterAll = document.getElementById("filter-count-all");
  if (filterAll) filterAll.textContent = String(s.cascade.length);
  const cascadeCount = document.getElementById("cascade-count");
  if (cascadeCount) cascadeCount.textContent = String(s.cascade.length);

  const heroCounter = document.getElementById("hero-canvas-counter");
  if (heroCounter) heroCounter.textContent = `${s.totals.cascadeEvents} receipts · ${s.totals.totalUpstreamPayments} hops`;
}

function renderStrategies(s: AtlasState) {
  const grid = document.getElementById("agents-grid");
  if (!grid) return;
  if (s.strategies.length === 0) {
    grid.innerHTML = '<div class="strategy-card placeholder">No strategies registered yet.</div>';
    return;
  }
  // Update history
  const now = Date.now();
  for (const a of s.strategies) {
    const equity = Number(BigInt(a.equity)) / 1_000_000;
    const h = equityHistory.get(a.address) ?? { x: [], y: [] };
    if (h.y.length === 0 || h.y[h.y.length - 1] !== equity) {
      h.x.push(now);
      h.y.push(equity);
    }
    while (h.x.length > HISTORY_MAX) {
      h.x.shift();
      h.y.shift();
    }
    equityHistory.set(a.address, h);
  }

  const sorted = s.strategies.slice().sort((a, b) => b.pnlPct - a.pnlPct);
  grid.innerHTML = sorted
    .map((a, i) => {
      const pnlClass = a.pnlPct >= 0 ? "pos" : "neg";
      const glyph = a.pnlPct >= 0 ? "▲" : "▼";
      const isSpecial = a.name === "Skeptic";
      const rankClass = i === 0 ? "gold" : "";
      return `
      <article class="strategy-card fade-in" data-addr="${a.address}">
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
        <div class="strategy-chart" data-chart="${a.address}"></div>
        <div class="strategy-stats">
          <div class="strategy-stat-row"><span>Equity</span><b>${fmtAmount(a.equity)}</b></div>
          <div class="strategy-stat-row"><span>Debt</span><b>${fmtAmount(a.currentDebt)}</b></div>
          <div class="strategy-stat-row"><span>Profit</span><b style="color:var(--pos)">${fmtAmount(a.cumulativeProfit)}</b></div>
          <div class="strategy-stat-row"><span>Loss</span><b style="color:var(--neg)">${fmtAmount(a.cumulativeLoss)}</b></div>
        </div>
        <div class="strategy-links">
          <a href="${s.chain.explorer}/address/${a.address}" target="_blank" rel="noopener">strategy ↗</a>
          <a href="${s.chain.explorer}/address/${a.subWallet}" target="_blank" rel="noopener">sub-wallet ↗</a>
        </div>
      </article>`;
    })
    .join("");

  // Render uPlot charts after DOM update
  for (const a of sorted) {
    const container = grid.querySelector<HTMLElement>(`[data-chart="${a.address}"]`);
    if (!container) continue;
    const h = equityHistory.get(a.address);
    if (!h || h.x.length < 2) continue;
    const existing = charts.get(a.address);
    if (existing) existing.destroy();
    const chart = makeStrategyChart(container, h, a.pnlPct >= 0);
    if (chart) charts.set(a.address, chart);
  }
}

// =========================================================================
// Cascade table (sortable + filterable + expandable)
// =========================================================================

const expandedRows = new Set<string>();

function renderCascadeTable(s: AtlasState) {
  const tbody = document.getElementById("cascade-tbody");
  if (!tbody) return;
  let rows = s.cascade.slice();
  if (cascadeFilter !== "all") {
    rows = rows.filter(() => true); // currently only "Skeptic" buyer; placeholder for future filters
  }
  rows.sort((a, b) => {
    const dir = cascadeSort.dir === "asc" ? 1 : -1;
    switch (cascadeSort.col) {
      case "time":
      case "block":
        return (a.block - b.block) * dir;
      case "buyer":
        return a.buyer.localeCompare(b.buyer) * dir;
      case "signal":
        return "safe-yield".localeCompare("safe-yield") * dir;
      case "hops":
        return (a.upstreams.length - b.upstreams.length) * dir;
      case "cost":
        return (Number(BigInt(a.buyerAmount)) - Number(BigInt(b.buyerAmount))) * dir;
      case "tx":
        return a.buyerSettlementTx.localeCompare(b.buyerSettlementTx) * dir;
      default:
        return 0;
    }
  });

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">
      <div class="empty-icon">⏳</div>
      Waiting for Skeptic to anchor a cascade receipt…
    </td></tr>`;
    return;
  }

  const headBlock = Math.max(...s.cascade.map((c) => c.block), 0);
  tbody.innerHTML = rows
    .slice(0, 30)
    .map((c) => {
      const cost = (Number(c.buyerAmount) / 1_000_000).toFixed(4);
      const exp = expandedRows.has(c.receiptId);
      const detailRow = exp
        ? `
      <tr class="detail">
        <td colspan="6">
          <div class="upstream-list">
            ${c.upstreams
              .map(
                (u) => `
              <a class="upstream-row" href="${s.chain.explorer}/tx/${u.settlementTx}" target="_blank" rel="noopener">
                <span class="arrow">└→</span>
                <span>${u.slug} <span style="color:var(--text-3)">(${shortAddr(u.author)})</span></span>
                <span class="amount">${(Number(u.amount) / 1_000_000).toFixed(4)} bUSD</span>
                <a href="${s.chain.explorer}/tx/${u.settlementTx}" target="_blank" rel="noopener">${shortTx(u.settlementTx)} ↗</a>
              </a>`
              )
              .join("")}
          </div>
        </td>
      </tr>`
        : "";
      return `
      <tr data-id="${c.receiptId}" class="${exp ? "expanded" : ""}">
        <td class="col-time">${timeAgo(headBlock - c.block)}</td>
        <td class="col-buyer">Skeptic</td>
        <td>safe-yield</td>
        <td class="col-hops"><span class="pill">${c.upstreams.length} hops</span></td>
        <td class="col-cost">${cost} bUSD</td>
        <td class="col-tx">${shortTx(c.buyerSettlementTx)} ${exp ? "▾" : "▸"}</td>
      </tr>${detailRow}`;
    })
    .join("");

  // Update sort indicator
  document.querySelectorAll<HTMLElement>(".cascade-table thead th").forEach((th) => {
    const c = th.getAttribute("data-sort");
    th.classList.toggle("sorted", c === cascadeSort.col);
    const ind = th.querySelector(".sort-indicator");
    if (ind) ind.textContent = c === cascadeSort.col ? (cascadeSort.dir === "asc" ? "↑" : "↓") : "";
  });

  // Click handlers
  tbody.querySelectorAll<HTMLElement>("tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      // Don't toggle if clicking a link inside
      if ((e.target as HTMLElement).tagName === "A") return;
      const id = tr.getAttribute("data-id") ?? "";
      if (expandedRows.has(id)) expandedRows.delete(id);
      else expandedRows.add(id);
      if (lastState) renderCascadeTable(lastState);
    });
  });
}

function renderVault(s: AtlasState) {
  const setText = (id: string, t: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = t;
  };
  setText("vault-tvl", `${fmtAmount(s.vault.tvl, { compact: true })} bUSD`);
  setText("vault-supply", `${fmtAmount(s.vault.totalSupply, { compact: true })} ATLS`);
  setText("vault-pps", `${(Number(BigInt(s.vault.pricePerShare)) / 1_000_000).toFixed(6)}`);
  setText("vault-status", s.vault.paused ? "PAUSED" : "Active");
  setText("amm-spot", `${(Number(BigInt(s.amm.spotXInBUSD)) / 1e18).toFixed(6)}`);
  setText("amm-twap", `${(Number(BigInt(s.amm.twap30m)) / 1e18).toFixed(6)}`);
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
// Tabs
// =========================================================================

function initTabs() {
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-tab");
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll<HTMLElement>(".tab-panel").forEach((p) => {
        p.classList.toggle("active", p.getAttribute("data-panel") === target);
      });
      // Re-render charts after tab activates so they get correct dimensions
      if (target === "strategies" && lastState) renderStrategies(lastState);
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

  document.querySelectorAll<HTMLButtonElement>(".filter-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      cascadeFilter = btn.getAttribute("data-filter") ?? "all";
      document.querySelectorAll(".filter-chip").forEach((b) => b.classList.toggle("active", b === btn));
      if (lastState) renderCascadeTable(lastState);
    });
  });
}

// =========================================================================
// Mobile drawer
// =========================================================================

function initMobileDrawer() {
  const toggle = document.getElementById("menu-toggle");
  const drawer = document.getElementById("mobile-drawer");
  if (!toggle || !drawer) return;
  toggle.addEventListener("click", () => drawer.classList.toggle("open"));
  drawer.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => drawer.classList.remove("open"))
  );
}

// =========================================================================
// Hero canvas — animated cascade visualization
// =========================================================================

interface Particle {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number;        // 0..1 progress
  speed: number;    // per-frame
  color: string;
  size: number;
}

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
    ctx.scale(dpr, dpr);
  };
  resize();
  window.addEventListener("resize", () => {
    canvas.getContext("2d")?.setTransform(1, 0, 0, 1, 0, 0);
    resize();
  });

  // Layout: composite center, 3 upstream nodes, plus a buyer node on the left
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
  let lastEmit = 0;
  const EMIT_INTERVAL = 2200; // ms — emits a fresh cascade

  // Soft pulse rings
  const pulses: Array<{ x: number; y: number; r: number; alpha: number; color: string }> = [];

  function emitCascade() {
    const L = getLayout();
    // Buyer → composite particle (mint green)
    particles.push({
      fromX: L.buyer.x, fromY: L.buyer.y,
      toX: L.composite.x, toY: L.composite.y,
      t: 0, speed: 0.012,
      color: "rgba(52, 211, 153, ",
      size: 4,
    });
    // Pulse at buyer
    pulses.push({ x: L.buyer.x, y: L.buyer.y, r: 6, alpha: 0.8, color: "52, 211, 153" });
    // After short delay, composite → 3 upstreams (violet/blue)
    setTimeout(() => {
      const L2 = getLayout();
      const colors = ["167, 139, 250", "96, 165, 250", "167, 139, 250"];
      L2.upstreams.forEach((up, i) => {
        particles.push({
          fromX: L2.composite.x, fromY: L2.composite.y,
          toX: up.x, toY: up.y,
          t: 0, speed: 0.015,
          color: `rgba(${colors[i]}, `,
          size: 3.5,
        });
      });
      pulses.push({ x: L2.composite.x, y: L2.composite.y, r: 6, alpha: 0.8, color: "96, 165, 250" });
    }, 700);
  }

  function drawNode(x: number, y: number, label: string, color: string, size = 14) {
    // Outer glow
    const g = ctx!.createRadialGradient(x, y, 0, x, y, size * 2.5);
    g.addColorStop(0, `rgba(${color}, 0.4)`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    ctx!.fillStyle = g;
    ctx!.beginPath();
    ctx!.arc(x, y, size * 2.5, 0, Math.PI * 2);
    ctx!.fill();
    // Core
    ctx!.fillStyle = `rgb(${color})`;
    ctx!.beginPath();
    ctx!.arc(x, y, size / 3, 0, Math.PI * 2);
    ctx!.fill();
    // Ring
    ctx!.strokeStyle = `rgba(${color}, 0.6)`;
    ctx!.lineWidth = 1;
    ctx!.beginPath();
    ctx!.arc(x, y, size, 0, Math.PI * 2);
    ctx!.stroke();
    // Label
    ctx!.fillStyle = "rgba(180, 182, 196, 0.7)";
    ctx!.font = '10px "Geist Mono", monospace';
    ctx!.textAlign = "center";
    ctx!.fillText(label, x, y + size + 14);
  }

  function drawConnection(fromX: number, fromY: number, toX: number, toY: number, color: string, alpha: number) {
    ctx!.strokeStyle = `rgba(${color}, ${alpha})`;
    ctx!.lineWidth = 1;
    ctx!.beginPath();
    // Curved line — quadratic bezier with control point offset
    const cx = (fromX + toX) / 2;
    const cy = (fromY + toY) / 2 - Math.abs(toX - fromX) * 0.05;
    ctx!.moveTo(fromX, fromY);
    ctx!.quadraticCurveTo(cx, cy, toX, toY);
    ctx!.stroke();
  }

  function frame(now: number) {
    if (!ctx) return;
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0, 0, w, h);

    // Background grid (subtle dots)
    ctx.fillStyle = "rgba(255, 255, 255, 0.025)";
    for (let x = 20; x < w; x += 24) {
      for (let y = 20; y < h; y += 24) {
        ctx.beginPath();
        ctx.arc(x, y, 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const L = getLayout();

    // Connections (faded)
    drawConnection(L.buyer.x, L.buyer.y, L.composite.x, L.composite.y, "52, 211, 153", 0.15);
    L.upstreams.forEach((up) => {
      drawConnection(L.composite.x, L.composite.y, up.x, up.y, "167, 139, 250", 0.15);
    });

    // Pulses
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i]!;
      ctx.strokeStyle = `rgba(${p.color}, ${p.alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();
      p.r += 1.4;
      p.alpha -= 0.025;
      if (p.alpha <= 0) pulses.splice(i, 1);
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.t += p.speed;
      const x = p.fromX + (p.toX - p.fromX) * p.t;
      const y = p.fromY + (p.toY - p.fromY) * p.t;
      const trail = 5;
      for (let k = 0; k < trail; k++) {
        const tk = Math.max(0, p.t - k * 0.04);
        const tx = p.fromX + (p.toX - p.fromX) * tk;
        const ty = p.fromY + (p.toY - p.fromY) * tk;
        const alpha = (1 - k / trail) * 0.8;
        ctx.fillStyle = p.color + alpha + ")";
        ctx.beginPath();
        ctx.arc(tx, ty, p.size * (1 - k / trail / 2), 0, Math.PI * 2);
        ctx.fill();
      }
      if (p.t >= 1) {
        // Pulse on arrival
        const pulseColor = p.color.replace("rgba(", "").replace(", ", "");
        const c = pulseColor.split(",").slice(0, 3).join(",");
        pulses.push({ x: p.toX, y: p.toY, r: 4, alpha: 0.8, color: c });
        particles.splice(i, 1);
      }
    }

    // Nodes
    drawNode(L.buyer.x, L.buyer.y, "Skeptic", "52, 211, 153", 14);
    drawNode(L.composite.x, L.composite.y, "safe-yield", "96, 165, 250", 18);
    L.upstreams.forEach((up) =>
      drawNode(up.x, up.y, up.label, "167, 139, 250", 12)
    );

    // Emit cascade periodically
    if (now - lastEmit > EMIT_INTERVAL) {
      emitCascade();
      lastEmit = now;
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// =========================================================================
// Main
// =========================================================================

async function main() {
  const s = await load();
  lastState = s;
  renderMetrics(s);
  renderStrategies(s);
  renderCascadeTable(s);
  renderVault(s);
  renderContracts(s);
  setTimeout(main, REFRESH_MS);
}

initTabs();
initMobileDrawer();
initHeroCanvas();
main();

// Update relative-age every 5s
setInterval(() => {
  if (!lastState) return;
  const lastEl = document.getElementById("last-updated");
  if (lastEl) lastEl.textContent = `synced · ${relativeAge(lastState.updatedAt)}`;
}, 5_000);
