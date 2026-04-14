/**
 * Atlas V2 deposit page. Browser wallet → bUSD.approve(vault) →
 * vault.deposit(assets, receiver). Reads atlas.json for V2 addresses.
 */

const ATLAS_URL = import.meta.env.VITE_ATLAS_URL ?? "/atlas.json";

interface Atlas {
  version: "v2";
  chain: { id: number };
  contracts: { AtlasVaultV2: string; bUSD: string };
}

// bytes4 selectors
const ERC20_APPROVE = "0x095ea7b3";
const VAULT_DEPOSIT_TWO_ARG = "0x6e553f65"; // deposit(uint256,address)

const connectBtn = document.getElementById("connect") as HTMLButtonElement;
const approveBtn = document.getElementById("approve") as HTMLButtonElement;
const depositBtn = document.getElementById("deposit") as HTMLButtonElement;
const accountDiv = document.getElementById("account") as HTMLDivElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;
const amountInput = document.getElementById("amount") as HTMLInputElement;
const busdLink = document.getElementById("busd-link") as HTMLAnchorElement;

let account: string | null = null;
let atlas: Atlas | null = null;

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

function logStatus(html: string) {
  statusDiv.innerHTML = html;
}

async function loadAtlas(): Promise<Atlas> {
  const r = await fetch(ATLAS_URL);
  return (await r.json()) as Atlas;
}

async function connect() {
  if (!window.ethereum) {
    logStatus(`<span style="color: var(--err)">No browser wallet detected.</span>`);
    return;
  }
  const accounts = await window.ethereum.request<string[]>({
    method: "eth_requestAccounts",
  });
  account = accounts?.[0] ?? null;
  if (!account) return;

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
  const data = ERC20_APPROVE + pad32(atlas.contracts.AtlasVaultV2) + bigToHex32(amount);
  logStatus(`<span class="dim">Approving ${amountInput.value} bUSD to V2 vault…</span>`);
  const tx = await window.ethereum!.request<string>({
    method: "eth_sendTransaction",
    params: [{ from: account, to: atlas.contracts.bUSD, data }],
  });
  const sh = (tx ?? "").length > 14 ? `${tx?.slice(0, 8)}…${tx?.slice(-6)}` : tx;
  logStatus(
    `<span class="ok">approve sent</span><div style="margin-top:8px"><a href="https://www.oklink.com/xlayer-test/tx/${tx}" target="_blank">${sh}</a></div>`
  );
}

async function deposit() {
  if (!account || !atlas) return;
  const amount = BigInt(Math.floor(Number(amountInput.value) * 1_000_000));
  // deposit(uint256 assets, address receiver) — two-arg ERC-4626 path
  const data =
    VAULT_DEPOSIT_TWO_ARG + bigToHex32(amount) + pad32(account);
  logStatus(`<span class="dim">Depositing ${amountInput.value} bUSD into Atlas V2…</span>`);
  const tx = await window.ethereum!.request<string>({
    method: "eth_sendTransaction",
    params: [{ from: account, to: atlas.contracts.AtlasVaultV2, data }],
  });
  const sh = (tx ?? "").length > 14 ? `${tx?.slice(0, 8)}…${tx?.slice(-6)}` : tx;
  logStatus(
    `<span class="ok">deposit sent</span><div style="margin-top:8px"><a href="https://www.oklink.com/xlayer-test/tx/${tx}" target="_blank">${sh}</a></div><div style="margin-top:10px;color:var(--text-3);font-size:12px;line-height:1.55">ATLS shares mint on confirmation. Withdraw via idle-liquidity (ERC-4626) or the WithdrawQueue for larger redemptions.</div>`
  );
}

async function main() {
  atlas = await loadAtlas();
  if (atlas.contracts.bUSD) {
    busdLink.href = `https://www.oklink.com/xlayer-test/address/${atlas.contracts.bUSD}`;
    busdLink.textContent = `${atlas.contracts.bUSD.slice(0, 10)}…${atlas.contracts.bUSD.slice(-6)}`;
  }
}

connectBtn.addEventListener("click", connect);
approveBtn.addEventListener("click", approve);
depositBtn.addEventListener("click", deposit);
main();
