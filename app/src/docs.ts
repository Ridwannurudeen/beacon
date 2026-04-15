/**
 * Docs page — wallet chip, TOC active-section, FAQ accordion, live demo widget.
 */
import * as wallet from "./wallet.js";
import { toast } from "./toast.js";
import { payAndCall, getBusdBalance, mintBusd, type BUSDDescriptor } from "./x402-browser.js";

const ATLAS_URL = "/atlas.json";
const SAFE_YIELD_URL = "https://safe-yield.gudman.xyz/signal/safe-yield";

interface Atlas {
  chain: { id: number; explorer: string };
  contracts: { bUSD: string };
  token?: { address: string; name: string; version: string; symbol: string; decimals: number };
}

let atlas: Atlas | null = null;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function shortTx(t: string): string { return t && t.length > 14 ? `${t.slice(0,8)}…${t.slice(-6)}` : t; }

function renderChip() {
  wallet.renderWalletChip("wallet-slot", { onToast: (msg, kind) => toast(msg, { kind }) });
}

async function refreshDemoWalletInfo() {
  const state = wallet.getState();
  const w = document.getElementById("demo-wallet");
  const b = document.getElementById("demo-balance");
  if (w) w.textContent = state.address ? wallet.shortAddr(state.address) : "not connected";
  if (b) {
    if (!state.address || !atlas?.contracts.bUSD) { b.textContent = "—"; return; }
    try {
      const bal = await getBusdBalance(state.address, atlas.contracts.bUSD);
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
    if (!atlas?.token) { toast("Atlas registry not loaded", { kind: "error" }); return; }
    callBtn.disabled = true;
    out.innerHTML = `<span class="dim">Probing endpoint, then signing EIP-3009 authorization…</span>`;
    const dismiss = toast("Calling safe-yield…", { kind: "pending" });
    try {
      const desc: BUSDDescriptor = {
        address: atlas.token.address, name: atlas.token.name,
        version: atlas.token.version, symbol: atlas.token.symbol, decimals: atlas.token.decimals,
      };
      const res = await payAndCall(SAFE_YIELD_URL, state.address, desc, atlas.chain.id);
      dismiss();
      const exp = atlas.chain.explorer;
      const ups = res.cascadeReceipt?.upstreams ?? [];
      out.innerHTML = `
        <div class="ok">${res.status} OK</div>
        <pre style="margin:8px 0 12px; white-space:pre-wrap; font-size:11px; line-height:1.5;">${escapeHtml(JSON.stringify(res.body, null, 2)).slice(0, 600)}</pre>
        ${res.paymentTx ? `<div>buyer settlement: <a href="${exp}/tx/${res.paymentTx}" target="_blank">${shortTx(res.paymentTx)} ↗</a></div>` : ""}
        ${res.cascadeReceipt ? `<div style="margin-top:10px;">composite: <span class="mono">${shortTx(res.cascadeReceipt.composite)}</span></div>
        <div style="margin-top:6px;"><b>${ups.length}</b> upstream payments:</div>
        <div class="upstream-list" style="margin-top:6px;">
          ${ups.map((u) => `<a class="upstream-row" href="${exp}/tx/${u.settlementTx}" target="_blank" rel="noopener">
            <span class="arrow">└→</span><span>${u.slug}</span>
            <span class="amount">${(Number(u.amount) / 1_000_000).toFixed(4)} bUSD</span>
            <span>${shortTx(u.settlementTx)} ↗</span></a>`).join("")}
        </div>` : ""}`;
      toast(`Signal returned · ${ups.length} cascade hops`, {
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
    if (!atlas?.contracts.bUSD) { toast("bUSD address not loaded", { kind: "error" }); return; }
    mintBtn.disabled = true;
    const dismiss = toast("Minting 1 bUSD…", { kind: "pending" });
    try {
      const tx = await mintBusd(state.address, 1_000_000n, atlas.contracts.bUSD);
      dismiss();
      toast("1 bUSD minted", { kind: "success", action: { label: "view tx", href: `${atlas.chain.explorer}/tx/${tx}` } });
      setTimeout(refreshDemoWalletInfo, 4000);
    } catch (e) {
      dismiss();
      toast(`Mint failed: ${(e as Error).message}`, { kind: "error" });
    } finally {
      mintBtn.disabled = false;
    }
  });
}

function initFAQ() {
  document.querySelectorAll<HTMLElement>(".faq-item").forEach((item) => {
    const q = item.querySelector(".faq-q");
    if (!q) return;
    q.addEventListener("click", () => item.classList.toggle("open"));
  });
}

function initTOC() {
  const toc = document.querySelector(".docs-toc");
  if (!toc) return;
  const links = Array.from(toc.querySelectorAll("a")) as HTMLAnchorElement[];
  const sections = links.map((a) => document.querySelector<HTMLElement>(a.getAttribute("href") ?? "")).filter((x): x is HTMLElement => !!x);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const id = e.target.id;
      links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${id}`));
    }
  }, { rootMargin: "-20% 0px -70% 0px", threshold: 0 });
  sections.forEach((s) => io.observe(s));
}

async function main() {
  try {
    const r = await fetch(ATLAS_URL, { cache: "no-store" });
    atlas = (await r.json()) as Atlas;
  } catch { /* demo will show error on call */ }
  wallet.init();
  wallet.onChange(() => { renderChip(); refreshDemoWalletInfo(); });
  initTOC();
  initFAQ();
  initDemoWidget();
}

main();
