/**
 * Autopilot client — Agentic Savings Account UI.
 *
 * Calls safe-yield on the Beacon VPS. The composite server internally cascades
 * to three upstream signals and returns their receipts in `output.cascade`.
 * We render four tx rows (one buyer-side + three upstream) so the demo shows
 * four X Layer testnet settlements after one click.
 */

interface CascadeReceipt {
  slug: string;
  paymentTx?: string;
  upstream: string;
}

interface SafeYieldOutput {
  output: {
    asset: string;
    safetyScore: number;
    expectedApyPct: number;
    recommendation: "deploy_full" | "deploy_partial" | "hold";
    bestVenue: string | null;
  };
  cascade: CascadeReceipt[];
}

interface SettlementReceipt {
  success: boolean;
  transaction: string;
  network: string;
  payer: string;
}

const SAFE_YIELD_URL =
  import.meta.env.VITE_SAFE_YIELD_URL ?? "https://safe-yield.gudman.xyz/signal";
const EXPLORER_TX = "https://www.oklink.com/xlayer-test/tx/";

const assetInput = document.getElementById("asset") as HTMLInputElement;
const amountInput = document.getElementById("amount") as HTMLInputElement;
const runBtn = document.getElementById("run") as HTMLButtonElement;
const executeBtn = document.getElementById("execute") as HTMLButtonElement;
const cascadeUl = document.getElementById("cascade") as HTMLUListElement;
const strategyDiv = document.getElementById("strategy") as HTMLDivElement;

let lastStrategy: SafeYieldOutput["output"] | null = null;

function renderCascade(
  items: Array<{ slug: string; tx?: string; label: string; status: "ok" | "err" }>
) {
  cascadeUl.innerHTML = items
    .map(
      (it) => `
      <li class="${it.status}">
        <span class="slug">${it.slug}</span>
        <span class="tx">${
          it.tx
            ? `<a href="${EXPLORER_TX}${it.tx}" target="_blank" rel="noopener">${it.tx.slice(0, 10)}…${it.tx.slice(-6)}</a>`
            : it.label
        }</span>
      </li>
    `
    )
    .join("");
}

function renderStrategy(s: SafeYieldOutput["output"]) {
  const recLabel =
    s.recommendation === "deploy_full"
      ? "Deploy full amount"
      : s.recommendation === "deploy_partial"
        ? "Deploy 50% / hold 50%"
        : "Hold — safety below threshold";
  strategyDiv.innerHTML = `
    <div class="score">${s.safetyScore}<span style="font-size: 16px; color: var(--muted)">/100</span></div>
    <div class="rec">${recLabel}</div>
    <div style="margin-top:12px; color: var(--muted)">
      Expected APY: <b>${s.expectedApyPct.toFixed(2)}%</b><br/>
      Best venue: <b>${s.bestVenue ?? "—"}</b>
    </div>
  `;
  executeBtn.disabled = s.recommendation === "hold";
}

async function run() {
  const asset = assetInput.value.trim();
  if (!asset || !/^0x[a-fA-F0-9]{40}$/.test(asset)) {
    alert("Enter a valid X Layer token address (0x…)");
    return;
  }

  runBtn.disabled = true;
  runBtn.textContent = "Paying safe-yield…";
  renderCascade([{ slug: "you → safe-yield", label: "pending…", status: "ok" }]);
  strategyDiv.innerHTML = '<span class="dim">Composite running…</span>';

  try {
    const url = new URL(SAFE_YIELD_URL);
    url.searchParams.set("asset", asset);
    // Demo mode: composite's `settlementWallet` + `payerWallet` do the work.
    // Replace with a wallet signing flow using @beacon/sdk fetchWithPayment
    // when a browser wallet (MetaMask + OKX Wallet) is wired.
    const res = await fetch(url.toString(), {
      headers: { "X-Demo-Bypass": "true" },
    });
    if (!res.ok) throw new Error(`composite ${res.status}: ${await res.text()}`);

    const data = (await res.json()) as SafeYieldOutput;
    const rh = res.headers.get("X-Payment-Response");
    const buyerTx = rh
      ? (JSON.parse(atob(rh)) as SettlementReceipt).transaction
      : undefined;

    const rows: Array<{ slug: string; tx?: string; label: string; status: "ok" | "err" }> = [
      {
        slug: "you → safe-yield",
        tx: buyerTx,
        label: buyerTx ? "" : "(demo — no user-side signer yet)",
        status: "ok",
      },
      ...data.cascade.map((c) => ({
        slug: `safe-yield → ${c.slug}`,
        tx: c.paymentTx,
        label: c.paymentTx ? "" : "verify-only",
        status: "ok" as const,
      })),
    ];
    renderCascade(rows);
    renderStrategy(data.output);
    lastStrategy = data.output;
  } catch (e) {
    const msg = (e as Error).message;
    renderCascade([{ slug: "error", label: msg, status: "err" }]);
    strategyDiv.innerHTML = `<span class="dim" style="color: var(--err)">${msg}</span>`;
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = "Query safe-yield →";
  }
}

async function execute() {
  if (!lastStrategy) return;
  alert(
    `Execute path routes ${amountInput.value} bUSD into ${lastStrategy.bestVenue ?? "best venue"} via Uniswap X Layer Testnet. Wire your wallet here — the autopilot-executor service handles the swap.`
  );
}

runBtn.addEventListener("click", run);
executeBtn.addEventListener("click", execute);
