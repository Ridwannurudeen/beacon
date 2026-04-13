/**
 * Atlas deposit page. Browser wallet (window.ethereum) → bUSD.approve(vault) →
 * vault.deposit(amount). Reads atlas.json for contract addresses.
 */

const ATLAS_URL = import.meta.env.VITE_ATLAS_URL ?? "/atlas.json";

interface Atlas {
  chain: { id: number };
  contracts: { AtlasVault: string; bUSD: string };
}

const VAULT_DEPOSIT_SELECTOR = "0xb6b55f25"; // deposit(uint256)
const ERC20_APPROVE_SELECTOR = "0x095ea7b3"; // approve(address,uint256)
const ERC20_BALANCEOF_SELECTOR = "0x70a08231";

const connectBtn = document.getElementById("connect") as HTMLButtonElement;
const approveBtn = document.getElementById("approve") as HTMLButtonElement;
const depositBtn = document.getElementById("deposit") as HTMLButtonElement;
const accountDiv = document.getElementById("account") as HTMLDivElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;
const amountInput = document.getElementById("amount") as HTMLInputElement;
const busdLink = document.getElementById("busd-link") as HTMLAnchorElement;

let account: string | null = null;
let atlas: Atlas | null = null;

function logStatus(html: string) {
  statusDiv.innerHTML = html;
}

async function loadAtlas(): Promise<Atlas> {
  const r = await fetch(ATLAS_URL);
  return (await r.json()) as Atlas;
}

function pad32(hex: string): string {
  return hex.replace(/^0x/, "").padStart(64, "0");
}
function bigToHex32(v: bigint): string {
  return pad32(v.toString(16));
}

interface EthRequestArguments {
  method: string;
  params?: unknown[];
}
interface EthereumProvider {
  request<T = unknown>(args: EthRequestArguments): Promise<T>;
}
declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

async function connect() {
  if (!window.ethereum) {
    logStatus(
      `<span style="color: var(--err)">No browser wallet detected. Install MetaMask or OKX Wallet.</span>`
    );
    return;
  }
  const accounts = await window.ethereum.request<string[]>({
    method: "eth_requestAccounts",
  });
  account = accounts?.[0] ?? null;
  if (!account) return;

  // Switch to X Layer testnet (chainId 1952 = 0x7a0)
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x7a0" }],
    });
  } catch (e) {
    const err = e as { code?: number };
    if (err.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x7a0",
            chainName: "X Layer Testnet",
            nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
            rpcUrls: ["https://testrpc.xlayer.tech"],
            blockExplorerUrls: ["https://www.oklink.com/xlayer-test"],
          },
        ],
      });
    }
  }

  accountDiv.textContent = `${account.slice(0, 8)}…${account.slice(-6)}`;
  approveBtn.disabled = false;
  depositBtn.disabled = false;
  logStatus(`<span class="dim">Wallet connected. Approve bUSD, then Deposit.</span>`);
}

async function approve() {
  if (!account || !atlas) return;
  const amount = BigInt(Math.floor(Number(amountInput.value) * 1_000_000));
  const data =
    ERC20_APPROVE_SELECTOR +
    pad32(atlas.contracts.AtlasVault) +
    bigToHex32(amount);
  logStatus(`<span class="dim">Approving ${amountInput.value} bUSD…</span>`);
  const tx = await window.ethereum!.request<string>({
    method: "eth_sendTransaction",
    params: [{ from: account, to: atlas.contracts.bUSD, data }],
  });
  logStatus(
    `<div>Approve sent: <a href="https://www.oklink.com/xlayer-test/tx/${tx}" target="_blank">${tx?.slice(0, 14)}…</a></div>`
  );
}

async function deposit() {
  if (!account || !atlas) return;
  const amount = BigInt(Math.floor(Number(amountInput.value) * 1_000_000));
  const data = VAULT_DEPOSIT_SELECTOR + bigToHex32(amount);
  logStatus(`<span class="dim">Depositing ${amountInput.value} bUSD into Atlas…</span>`);
  const tx = await window.ethereum!.request<string>({
    method: "eth_sendTransaction",
    params: [{ from: account, to: atlas.contracts.AtlasVault, data }],
  });
  logStatus(
    `<div class="rec">Deposit sent</div><div style="margin-top:8px"><a href="https://www.oklink.com/xlayer-test/tx/${tx}" target="_blank">${tx?.slice(0, 14)}…</a></div><div style="margin-top:8px;color:var(--muted);font-size:13px">Your ATLS shares mint when the tx confirms. Watch the leaderboard at <a href="/">/</a>.</div>`
  );
}

async function main() {
  atlas = await loadAtlas();
  busdLink.href = `https://www.oklink.com/xlayer-test/address/${atlas.contracts.bUSD}`;
  busdLink.textContent = `${atlas.contracts.bUSD.slice(0, 10)}…${atlas.contracts.bUSD.slice(-6)}`;
}

connectBtn.addEventListener("click", connect);
approveBtn.addEventListener("click", approve);
depositBtn.addEventListener("click", deposit);
main();
