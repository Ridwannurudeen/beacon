/**
 * Shared wallet connect helpers. Persists the connected account across pages
 * via localStorage and a small event emitter so nav + demo widget + deposit/
 * withdraw all stay in sync.
 */

export const X_LAYER_TESTNET_HEX = "0x7a0";
export const X_LAYER_TESTNET_ID = 1952;
export const X_LAYER_FAUCET_URL = "https://www.okx.com/xlayer/faucet";
const STORAGE_KEY = "beacon.wallet.address";

export interface WalletState {
  address: string | null;
  chainId: string | null; // hex, e.g. "0x7a0"
}

export function isCorrectChain(s: WalletState): boolean {
  return (s.chainId ?? "").toLowerCase() === X_LAYER_TESTNET_HEX;
}

interface EthRequestArguments {
  method: string;
  params?: unknown[];
}
export interface EthereumProvider {
  request<T = unknown>(args: EthRequestArguments): Promise<T>;
  on?: (event: string, fn: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, fn: (...args: unknown[]) => void) => void;
}
declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const listeners = new Set<(s: WalletState) => void>();
let current: WalletState = { address: null, chainId: null };

export function getState(): WalletState {
  return current;
}

export function onChange(fn: (s: WalletState) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(current);
}

function setAddress(addr: string | null) {
  current = { ...current, address: addr };
  if (addr) localStorage.setItem(STORAGE_KEY, addr);
  else localStorage.removeItem(STORAGE_KEY);
  emit();
}

function setChain(chainId: string | null) {
  current = { ...current, chainId: chainId ? chainId.toLowerCase() : null };
  emit();
}

async function readChain() {
  const eth = getProvider();
  if (!eth) return;
  try {
    const id = (await eth.request<string>({ method: "eth_chainId" })) ?? null;
    setChain(id);
  } catch { /* ignore */ }
}

async function pollForChain(targetHex: string, timeoutMs = 3000): Promise<boolean> {
  const eth = getProvider();
  if (!eth) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const id = (await eth.request<string>({ method: "eth_chainId" })) ?? "";
      setChain(id);
      if (id.toLowerCase() === targetHex) return true;
    } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

export function getProvider(): EthereumProvider | null {
  return typeof window !== "undefined" ? (window.ethereum ?? null) : null;
}

export async function connectWallet(): Promise<string | null> {
  const eth = getProvider();
  if (!eth) {
    alert("No browser wallet detected. Install MetaMask or OKX Wallet.");
    return null;
  }
  try {
    const accounts = await eth.request<string[]>({ method: "eth_requestAccounts" });
    const addr = accounts?.[0] ?? null;
    if (!addr) return null;
    setAddress(addr);
    await readChain();
    // Attempt chain switch, but don't block the connection if the user rejects.
    try { await ensureChain(); await readChain(); } catch { /* user can switch later */ }
    return addr;
  } catch (e) {
    console.warn("connect failed", e);
    return null;
  }
}

export function disconnectWallet() {
  setAddress(null);
}

const X_LAYER_ADD_PARAMS = {
  chainId: X_LAYER_TESTNET_HEX,
  chainName: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: ["https://testrpc.xlayer.tech"],
  blockExplorerUrls: ["https://www.oklink.com/xlayer-test"],
};

export async function ensureChain() {
  const eth = getProvider();
  if (!eth) return;
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: X_LAYER_TESTNET_HEX }],
    });
  } catch (e) {
    const err = e as { code?: number };
    if (err.code === 4902 || err.code === -32603) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [X_LAYER_ADD_PARAMS],
      });
      try {
        await eth.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: X_LAYER_TESTNET_HEX }],
        });
      } catch { /* some wallets auto-switch after add */ }
    } else {
      throw e;
    }
  }
}

export class SwitchChainError extends Error {
  code: number | undefined;
  constructor(msg: string, code?: number) { super(msg); this.code = code; }
}

export async function switchToTestnet(): Promise<void> {
  const eth = getProvider();
  if (!eth) throw new SwitchChainError("No wallet detected");
  try {
    await ensureChain();
  } catch (e) {
    const err = e as { code?: number; message?: string };
    if (err.code === 4001) throw new SwitchChainError("You rejected the chain switch in your wallet.", 4001);
    throw new SwitchChainError(err.message || "Your wallet refused to switch. Try adding X Layer Testnet manually — see Docs.", err.code);
  }
  const ok = await pollForChain(X_LAYER_TESTNET_HEX);
  if (!ok) throw new SwitchChainError("Switch did not take effect. Confirm X Layer Testnet is selected in your wallet.");
}

export function shortAddr(a: string): string {
  if (!a || a.length < 14) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function init() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) current = { address: stored, chainId: null };

  const eth = getProvider();
  if (eth?.on) {
    eth.on("accountsChanged", (...args: unknown[]) => {
      const accounts = (args[0] as string[]) ?? [];
      setAddress(accounts[0] ?? null);
      if (accounts[0]) readChain();
    });
    eth.on("chainChanged", (...args: unknown[]) => {
      const id = args[0] as string;
      setChain(id ?? null);
    });
  }
  if (current.address) readChain();
}

/**
 * Shared wallet-chip renderer. Shows Connect button, address + disconnect,
 * or wrong-chain warning with switch button.
 */
export function renderWalletChip(slotId: string, opts: { onToast?: (msg: string, kind: "info" | "success" | "error") => void } = {}) {
  const slot = document.getElementById(slotId);
  if (!slot) return;
  const state = current;
  const toast = opts.onToast ?? (() => {});
  if (!state.address) {
    slot.innerHTML = `<button class="btn sm" data-wallet-connect>Connect</button>`;
    slot.querySelector("[data-wallet-connect]")?.addEventListener("click", async () => {
      const a = await connectWallet();
      if (a) toast(`Connected ${shortAddr(a)}`, "success");
    });
    return;
  }
  const wrongChain = !isCorrectChain(state);
  slot.innerHTML = `
    <span class="wallet-chip ${wrongChain ? "wrong-chain" : ""}" title="${state.address}">
      <span class="wallet-chip-avatar"></span>
      <span class="wallet-chip-addr">${shortAddr(state.address)}</span>
      ${wrongChain ? `<button class="wallet-chip-switch" data-wallet-switch>Switch to X Layer Testnet</button>` : `<span class="wallet-chip-chain">X Layer Testnet</span>`}
      <button class="wallet-chip-disconnect" data-wallet-disconnect aria-label="Disconnect">×</button>
    </span>`;
  slot.querySelector("[data-wallet-switch]")?.addEventListener("click", async () => {
    try {
      await switchToTestnet();
      toast("Switched to X Layer Testnet", "success");
    } catch (e) {
      toast((e as Error).message || "Failed to switch chain", "error");
    }
  });
  slot.querySelector("[data-wallet-disconnect]")?.addEventListener("click", () => {
    disconnectWallet();
    toast("Wallet disconnected", "info");
  });
}
