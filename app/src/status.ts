/**
 * Status page — health checks for Beacon signal endpoints.
 */
import * as wallet from "./wallet.js";
import { toast } from "./toast.js";

const ENDPOINTS = [
  { name: "Atlas dashboard", url: "https://beacon.gudman.xyz/atlas.json" },
  { name: "safe-yield (composite)", url: "https://safe-yield.gudman.xyz/health" },
  { name: "wallet-risk", url: "https://wallet-risk.gudman.xyz/health" },
  { name: "liquidity-depth", url: "https://liquidity-depth.gudman.xyz/health" },
  { name: "yield-score", url: "https://yield-score.gudman.xyz/health" },
  { name: "MCP server", url: "https://mcp.gudman.xyz/health" },
];

function renderChip() {
  wallet.renderWalletChip("wallet-slot", { onToast: (msg, kind) => toast(msg, { kind }) });
}

async function render() {
  const grid = document.getElementById("status-grid");
  const upd = document.getElementById("status-updated");
  if (!grid) return;
  grid.innerHTML = ENDPOINTS.map((s) => `
    <div class="status-item" data-name="${s.name}">
      <div class="status-item-name">${s.name}<span>${s.url.replace(/^https?:\/\//, "")}</span></div>
      <div class="status-item-state"><span class="status-dot status-dot-yellow"></span><span>checking…</span></div>
    </div>`).join("");

  await Promise.all(ENDPOINTS.map(async (s) => {
    const el = grid.querySelector<HTMLElement>(`[data-name="${s.name}"] .status-item-state`);
    const t0 = performance.now();
    try {
      const r = await fetch(s.url, { cache: "no-store" });
      const ms = Math.round(performance.now() - t0);
      const ok = r.ok;
      if (el) el.innerHTML = `<span class="status-dot ${ok ? "" : "status-dot-red"}"></span><span>${ok ? "up" : String(r.status)} · ${ms}ms</span>`;
    } catch {
      if (el) el.innerHTML = `<span class="status-dot status-dot-red"></span><span>down</span>`;
    }
  }));
  if (upd) upd.textContent = `last check · ${new Date().toLocaleTimeString()}`;
}

wallet.init();
wallet.onChange(renderChip);
render();
setInterval(render, 60_000);
