/**
 * Withdraw page. ERC-4626 redeem(shares, receiver, owner) — pulls from idle.
 */
import * as wallet from "./wallet.js";
import { toast } from "./toast.js";

const ATLAS_URL = "/atlas.json";

interface Atlas {
  contracts: { AtlasVaultV2: string; bUSD: string };
}

const ERC20_BALANCE_OF = "0x70a08231";
// redeem(uint256 shares, address receiver, address owner)
const VAULT_REDEEM = "0xba087652";

function pad32(hex: string): string { return hex.replace(/^0x/, "").padStart(64, "0"); }
function bigToHex32(v: bigint): string { return pad32(v.toString(16)); }

const connectBtn = document.getElementById("connect") as HTMLButtonElement;
const redeemBtn = document.getElementById("redeem") as HTMLButtonElement;
const accountDiv = document.getElementById("account") as HTMLDivElement;
const sharesInfo = document.getElementById("shares-info") as HTMLDivElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;
const sharesInput = document.getElementById("shares") as HTMLInputElement;

let atlas: Atlas | null = null;

function logStatus(html: string) { statusDiv.innerHTML = html; }
function shortTx(tx: string): string { return tx.length > 14 ? `${tx.slice(0,8)}…${tx.slice(-6)}` : tx; }

async function loadAtlas(): Promise<Atlas> {
  const r = await fetch(ATLAS_URL);
  return (await r.json()) as Atlas;
}

async function getShareBalance(addr: string): Promise<bigint> {
  if (!atlas) return 0n;
  const data = ERC20_BALANCE_OF + pad32(addr);
  const res = await fetch("https://testrpc.xlayer.tech", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", params: [{ to: atlas.contracts.AtlasVaultV2, data }, "latest"], id: 1 }),
  });
  const j = await res.json();
  return BigInt(j.result ?? "0x0");
}

async function refresh() {
  const state = wallet.getState();
  if (!state.address) {
    accountDiv.textContent = "Not connected";
    sharesInfo.textContent = "";
    redeemBtn.disabled = true;
    return;
  }
  accountDiv.textContent = wallet.shortAddr(state.address);
  redeemBtn.disabled = false;
  try {
    const bal = await getShareBalance(state.address);
    sharesInfo.textContent = `Holdings: ${(Number(bal) / 1_000_000).toFixed(2)} ATLS`;
  } catch { /* */ }
}

async function connect() {
  const a = await wallet.connectWallet();
  if (a) toast(`Connected ${wallet.shortAddr(a)}`, { kind: "success" });
}

async function redeem() {
  if (!atlas) return;
  const state = wallet.getState();
  if (!state.address) return;
  const shares = BigInt(Math.floor(Number(sharesInput.value) * 1_000_000));
  if (shares === 0n) { toast("Enter a non-zero share amount", { kind: "error" }); return; }
  const data =
    VAULT_REDEEM +
    bigToHex32(shares) +
    pad32(state.address) +
    pad32(state.address);
  redeemBtn.disabled = true;
  const dismiss = toast("Submitting redemption…", { kind: "pending" });
  logStatus(`<span class="dim">Submitting redemption of ${sharesInput.value} ATLS…</span>`);
  try {
    const tx = await window.ethereum!.request<string>({
      method: "eth_sendTransaction",
      params: [{ from: state.address, to: atlas.contracts.AtlasVaultV2, data }],
    });
    dismiss();
    toast("Redemption sent", { kind: "success", action: { label: "view tx", href: `https://www.oklink.com/xlayer-test/tx/${tx}` } });
    logStatus(`<span class="ok">redeemed</span><div style="margin-top:8px"><a href="https://www.oklink.com/xlayer-test/tx/${tx}" target="_blank">${shortTx(tx ?? "")}</a></div>`);
    setTimeout(refresh, 4000);
  } catch (e) {
    dismiss();
    const msg = (e as Error).message;
    toast(`Redemption failed: ${msg}`, { kind: "error" });
    logStatus(`<span style="color:var(--neg)">error</span>\n${msg}`);
  } finally {
    redeemBtn.disabled = false;
  }
}

function renderWalletChip() {
  const slot = document.getElementById("wallet-slot");
  if (!slot) return;
  const state = wallet.getState();
  if (!state.address) {
    slot.innerHTML = `<button class="btn sm" id="wallet-connect-btn">Connect</button>`;
    document.getElementById("wallet-connect-btn")?.addEventListener("click", connect);
    return;
  }
  slot.innerHTML = `<span class="wallet-chip"><span class="wallet-chip-avatar"></span><span class="wallet-chip-addr">${wallet.shortAddr(state.address)}</span></span>`;
}

async function main() {
  atlas = await loadAtlas();
  wallet.init();
  wallet.onChange(() => { renderWalletChip(); refresh(); });
  connectBtn.addEventListener("click", connect);
  redeemBtn.addEventListener("click", redeem);
}
main();
