/**
 * Atlas V2 deposit page. bUSD.approve(vault) → vault.deposit(assets, receiver).
 */
import * as wallet from "./wallet.js";
import { toast } from "./toast.js";

const ATLAS_URL = import.meta.env.VITE_ATLAS_URL ?? "/atlas.json";

interface Atlas {
  version: "v2";
  chain: { id: number; explorer: string };
  contracts: { AtlasVaultV2: string; bUSD: string };
}

const ERC20_APPROVE = "0x095ea7b3";
const VAULT_DEPOSIT_TWO_ARG = "0x6e553f65";

const connectBtn = document.getElementById("connect") as HTMLButtonElement;
const approveBtn = document.getElementById("approve") as HTMLButtonElement;
const depositBtn = document.getElementById("deposit") as HTMLButtonElement;
const accountDiv = document.getElementById("account") as HTMLDivElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;
const amountInput = document.getElementById("amount") as HTMLInputElement;
const busdLink = document.getElementById("busd-link") as HTMLAnchorElement | null;

let atlas: Atlas | null = null;

function pad32(hex: string): string { return hex.replace(/^0x/, "").padStart(64, "0"); }
function bigToHex32(v: bigint): string { return pad32(v.toString(16)); }
function shortTx(t: string): string { return t && t.length > 14 ? `${t.slice(0,8)}…${t.slice(-6)}` : t; }
function logStatus(html: string) { statusDiv.innerHTML = html; }

async function loadAtlas(): Promise<Atlas> {
  const r = await fetch(ATLAS_URL);
  return (await r.json()) as Atlas;
}

function refreshState() {
  const state = wallet.getState();
  if (!state.address) {
    accountDiv.textContent = "Not connected";
    approveBtn.disabled = true;
    depositBtn.disabled = true;
    return;
  }
  accountDiv.textContent = wallet.shortAddr(state.address);
  approveBtn.disabled = false;
  depositBtn.disabled = false;
}

async function connect() {
  const a = await wallet.connectWallet();
  if (a) {
    toast(`Connected ${wallet.shortAddr(a)}`, { kind: "success" });
    logStatus(`<span class="dim">Wallet connected. Approve bUSD, then Deposit.</span>`);
  }
}

async function approve() {
  const state = wallet.getState();
  if (!state.address || !atlas) return;
  const amount = BigInt(Math.floor(Number(amountInput.value) * 1_000_000));
  const data = ERC20_APPROVE + pad32(atlas.contracts.AtlasVaultV2) + bigToHex32(amount);
  const dismiss = toast(`Approving ${amountInput.value} bUSD…`, { kind: "pending" });
  logStatus(`<span class="dim">Approving ${amountInput.value} bUSD to V2 vault…</span>`);
  try {
    const tx = await window.ethereum!.request<string>({
      method: "eth_sendTransaction",
      params: [{ from: state.address, to: atlas.contracts.bUSD, data }],
    });
    dismiss();
    toast("Approve sent", { kind: "success", action: { label: "view tx", href: `${atlas.chain.explorer}/tx/${tx}` } });
    logStatus(`<span class="ok">approve sent</span><div style="margin-top:8px"><a href="${atlas.chain.explorer}/tx/${tx}" target="_blank">${shortTx(tx ?? "")}</a></div>`);
  } catch (e) {
    dismiss();
    toast(`Approve failed: ${(e as Error).message}`, { kind: "error" });
  }
}

async function deposit() {
  const state = wallet.getState();
  if (!state.address || !atlas) return;
  const amount = BigInt(Math.floor(Number(amountInput.value) * 1_000_000));
  const data = VAULT_DEPOSIT_TWO_ARG + bigToHex32(amount) + pad32(state.address);
  const dismiss = toast(`Depositing ${amountInput.value} bUSD…`, { kind: "pending" });
  logStatus(`<span class="dim">Depositing ${amountInput.value} bUSD into Atlas V2…</span>`);
  try {
    const tx = await window.ethereum!.request<string>({
      method: "eth_sendTransaction",
      params: [{ from: state.address, to: atlas.contracts.AtlasVaultV2, data }],
    });
    dismiss();
    toast("Deposit sent", { kind: "success", action: { label: "view tx", href: `${atlas.chain.explorer}/tx/${tx}` } });
    logStatus(`<span class="ok">deposit sent</span><div style="margin-top:8px"><a href="${atlas.chain.explorer}/tx/${tx}" target="_blank">${shortTx(tx ?? "")}</a></div><div style="margin-top:10px;color:var(--text-3);font-size:12px;line-height:1.55">ATLS shares mint on confirmation. Withdraw via the <a href="/withdraw.html">withdraw page</a>.</div>`);
  } catch (e) {
    dismiss();
    toast(`Deposit failed: ${(e as Error).message}`, { kind: "error" });
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
  if (busdLink && atlas.contracts.bUSD) {
    busdLink.href = `${atlas.chain.explorer}/address/${atlas.contracts.bUSD}`;
    busdLink.textContent = `${atlas.contracts.bUSD.slice(0, 10)}…${atlas.contracts.bUSD.slice(-6)}`;
  }
  wallet.init();
  wallet.onChange(() => { renderWalletChip(); refreshState(); });
  connectBtn.addEventListener("click", connect);
  approveBtn.addEventListener("click", approve);
  depositBtn.addEventListener("click", deposit);
}

main();
