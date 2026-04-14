/**
 * Shared wallet connect helpers. Persists the connected account across pages
 * via localStorage and a small event emitter so nav + demo widget + deposit/
 * withdraw all stay in sync.
 */

const X_LAYER_TESTNET = "0x7a0";
const STORAGE_KEY = "beacon.wallet.address";

export interface WalletState {
  address: string | null;
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
let current: WalletState = { address: null };

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
  current = { address: addr };
  if (addr) localStorage.setItem(STORAGE_KEY, addr);
  else localStorage.removeItem(STORAGE_KEY);
  emit();
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
    await ensureChain();
    setAddress(addr);
    return addr;
  } catch (e) {
    console.warn("connect failed", e);
    return null;
  }
}

export function disconnectWallet() {
  setAddress(null);
}

export async function ensureChain() {
  const eth = getProvider();
  if (!eth) return;
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: X_LAYER_TESTNET }],
    });
  } catch (e) {
    const err = e as { code?: number };
    if (err.code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: X_LAYER_TESTNET,
            chainName: "X Layer Testnet",
            nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
            rpcUrls: ["https://testrpc.xlayer.tech"],
            blockExplorerUrls: ["https://www.oklink.com/xlayer-test"],
          },
        ],
      });
    }
  }
}

export function shortAddr(a: string): string {
  if (!a || a.length < 14) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function init() {
  // Restore from storage
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) current = { address: stored };

  const eth = getProvider();
  if (eth?.on) {
    eth.on("accountsChanged", (...args: unknown[]) => {
      const accounts = (args[0] as string[]) ?? [];
      setAddress(accounts[0] ?? null);
    });
    eth.on("chainChanged", () => {
      // noop — page will use whatever chain user picks; we don't auto-reload
    });
  }
}
