/**
 * Landing page client. Reads signal registry (static JSON for demo; swap with
 * on-chain SignalRegistered event indexer in prod) and renders the live grid +
 * aggregate metrics.
 */

interface RegistryEntry {
  slug: string;
  description: string;
  url: string;
  author: string;
  price: string; // base units
  token: string;
  isComposite?: boolean;
  upstream?: string[];
}

interface RegistryResponse {
  signals: RegistryEntry[];
  metrics: {
    signalsPublished: number;
    composites: number;
    callsSettled: number;
    volumeBaseUnits: string; // total USDT0 cascaded, base units
  };
}

const REGISTRY_URL = import.meta.env.VITE_REGISTRY_URL ?? "/registry.json";
const EXPLORER = "https://www.oklink.com/xlayer-test";
void EXPLORER;

async function loadRegistry(): Promise<RegistryResponse> {
  try {
    const res = await fetch(REGISTRY_URL);
    if (!res.ok) throw new Error(`registry ${res.status}`);
    return (await res.json()) as RegistryResponse;
  } catch {
    // Fallback demo data so the page renders locally before deploy.
    return {
      signals: [
        {
          slug: "wallet-risk",
          description:
            "Risk-scores an EVM wallet on X Layer via on-chain activity, bytecode, sanctions proximity.",
          url: "https://wallet-risk.gudman.xyz/signal",
          author: "0x0000000000000000000000000000000000000000",
          price: "1000",
          token: "bUSD",
        },
        {
          slug: "liquidity-depth",
          description:
            "Reads Uniswap v3 pool liquidity, sqrt price, tick, and reserves on X Layer.",
          url: "https://liquidity-depth.gudman.xyz/signal",
          author: "0x0000000000000000000000000000000000000000",
          price: "2000",
          token: "bUSD",
        },
        {
          slug: "yield-score",
          description: "Normalized APY across X Layer lending venues for a given asset.",
          url: "https://yield-score.gudman.xyz/signal",
          author: "0x0000000000000000000000000000000000000000",
          price: "1500",
          token: "bUSD",
        },
        {
          slug: "safe-yield",
          description:
            "Composite: safety-adjusted yield recommendation. Cascades x402 payments to three upstream signals.",
          url: "https://safe-yield.gudman.xyz/signal",
          author: "0x0000000000000000000000000000000000000000",
          price: "6000",
          token: "bUSD",
          isComposite: true,
          upstream: ["wallet-risk", "liquidity-depth", "yield-score"],
        },
      ],
      metrics: {
        signalsPublished: 4,
        composites: 1,
        callsSettled: 0,
        volumeBaseUnits: "0",
      },
    };
  }
}

function formatPrice(baseUnits: string, token: string): string {
  const n = Number(baseUnits) / 1_000_000;
  return `${n.toFixed(n < 0.01 ? 4 : 2)} ${token}`;
}

function formatVolume(baseUnits: string): string {
  const n = Number(baseUnits) / 1_000_000;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}K`;
  return n.toFixed(2);
}

function renderMetrics(metrics: RegistryResponse["metrics"]) {
  document.querySelector<HTMLSpanElement>('[data-metric="signals"]')!.textContent =
    metrics.signalsPublished.toString();
  document.querySelector<HTMLSpanElement>('[data-metric="composites"]')!.textContent =
    metrics.composites.toString();
  document.querySelector<HTMLSpanElement>('[data-metric="calls"]')!.textContent =
    metrics.callsSettled.toLocaleString();
  document.querySelector<HTMLSpanElement>('[data-metric="volume"]')!.textContent =
    formatVolume(metrics.volumeBaseUnits);
}

function renderSignals(signals: RegistryEntry[]) {
  const grid = document.getElementById("signals-grid")!;
  grid.innerHTML = signals
    .map(
      (s) => `
      <a href="${s.url}/meta" target="_blank" rel="noopener" class="signal-card">
        <div class="slug">${s.slug}${s.isComposite ? '<span class="composite-tag">composite</span>' : ""}</div>
        <div class="desc">${s.description}</div>
        <div class="meta-row">
          <span>${formatPrice(s.price, s.token)}</span>
          <span>${s.isComposite && s.upstream ? `⇅ ${s.upstream.length}` : "base"}</span>
        </div>
      </a>
    `
    )
    .join("");
}

async function main() {
  const registry = await loadRegistry();
  renderMetrics(registry.metrics);
  renderSignals(registry.signals);
}

main();
