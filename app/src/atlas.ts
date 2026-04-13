/**
 * Atlas dashboard client. Reads a /atlas.json registry produced server-side
 * (built from the on-chain SignalRegistry + AgentRegistry + AtlasVault).
 * Renders the vault metrics, the agent leaderboard, and the contract addresses.
 */

interface AgentEntry {
  id: string;
  address: string;
  name: string;
  strategy: string;
  startingCapital: string;
  equity: string;
  pnlAbs: string;
  pnlPct: number;
  tradeCount: number;
  signalCount: number;
  cascadeSpend: string;
}

interface AtlasState {
  chain: { id: number; name: string; explorer: string };
  contracts: {
    AtlasVault: string;
    AgentRegistry: string;
    DemoAMM: string;
    MockX: string;
    bUSD: string;
  };
  vault: {
    tvl: string; // base units
    totalSupply: string;
    pricePerShare: string; // 6 dec
  };
  amm: { spotXInBUSD: string };
  agents: AgentEntry[];
  totals: { trades: number; signals: number; cascadeSpend: string };
  updatedAt: string;
}

const ATLAS_URL = import.meta.env.VITE_ATLAS_URL ?? "/atlas.json";

async function load(): Promise<AtlasState> {
  try {
    const res = await fetch(ATLAS_URL);
    if (!res.ok) throw new Error(`atlas ${res.status}`);
    return (await res.json()) as AtlasState;
  } catch {
    return fallback();
  }
}

function fallback(): AtlasState {
  return {
    chain: { id: 1952, name: "X Layer Testnet", explorer: "https://www.oklink.com/xlayer-test" },
    contracts: {
      AtlasVault: "0x113b660d9F53015cc3478f595835554A5DB7dff2",
      AgentRegistry: "0x2F41E56C09BB117dD8F1E3B648ADA403e460c454",
      DemoAMM: "0x54F90b6D39284806639Bf376C28FA07d3547Cd76",
      MockX: "0x320830a9094e955EdD366802127f4F056CF4B08B",
      bUSD: "0xe5A5A31145dc44EB3BD701897cd825b2443A6B76",
    },
    vault: { tvl: "0", totalSupply: "0", pricePerShare: "1000000" },
    amm: { spotXInBUSD: "1000000000000000000" },
    agents: [],
    totals: { trades: 0, signals: 0, cascadeSpend: "0" },
    updatedAt: new Date().toISOString(),
  };
}

function fmtUSD(baseUnits: string): string {
  const n = Number(BigInt(baseUnits)) / 1_000_000;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}K`;
  return n.toFixed(2);
}

function fmtNAV(baseUnits: string): string {
  const n = Number(BigInt(baseUnits)) / 1_000_000;
  return n.toFixed(4);
}

function fmtPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function renderMetrics(s: AtlasState) {
  document.querySelector<HTMLElement>('[data-metric="tvl"]')!.textContent = fmtUSD(s.vault.tvl);
  document.querySelector<HTMLElement>('[data-metric="nav"]')!.textContent = fmtNAV(s.vault.pricePerShare);
  document.querySelector<HTMLElement>('[data-metric="trades"]')!.textContent =
    s.totals.trades.toLocaleString();
  document.querySelector<HTMLElement>('[data-metric="cascade"]')!.textContent =
    `${fmtUSD(s.totals.cascadeSpend)} bUSD`;
}

function renderAgents(s: AtlasState) {
  const grid = document.getElementById("agents-grid")!;
  if (s.agents.length === 0) {
    grid.innerHTML = '<div class="agent-card placeholder">No agents registered yet.</div>';
    return;
  }
  // Sort by PnL descending
  const sorted = s.agents.slice().sort((a, b) => b.pnlPct - a.pnlPct);
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
          <div><span>Trades</span><b>${a.tradeCount}</b></div>
          <div><span>Signals</span><b>${a.signalCount}</b></div>
          <div><span>Cascade spend</span><b>${fmtUSD(a.cascadeSpend)}</b></div>
        </div>
        <a class="agent-link" href="${s.chain.explorer}/address/${a.address}" target="_blank" rel="noopener">view on OKLink →</a>
      </div>`;
    })
    .join("");
}

function renderContracts(s: AtlasState) {
  for (const [name, addr] of Object.entries(s.contracts)) {
    const el = document.querySelector<HTMLAnchorElement>(`[data-contract="${name}"]`);
    if (!el) continue;
    el.textContent = `${addr.slice(0, 8)}…${addr.slice(-6)}`;
    el.href = `${s.chain.explorer}/address/${addr}`;
  }
}

async function main() {
  const s = await load();
  renderMetrics(s);
  renderAgents(s);
  renderContracts(s);
  setTimeout(main, 30_000); // refresh every 30s
}

main();
