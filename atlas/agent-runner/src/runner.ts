import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  xLayerTestnet,
  fetchWithPayment,
  type SettlementToken,
} from "@beacon/sdk";
import { ERC20_ABI, AMM_ABI, REGISTRY_ABI } from "./abi.js";
import type { Strategy, Decision } from "./strategies/types.js";

interface RunnerConfig {
  privateKey: Hex;
  bUSD: Address;
  mockX: Address;
  amm: Address;
  registry: Address;
  busdToken: SettlementToken; // for x402 EIP-712 signing of signal payments
  signalUrls: {
    "wallet-risk": string;
    "liquidity-depth": string;
    "yield-score": string;
    "safe-yield": string;
  };
  signalPrices: {
    "wallet-risk": bigint;
    "liquidity-depth": bigint;
    "yield-score": bigint;
    "safe-yield": bigint;
  };
  rpcUrl: string;
  /** A canonical X Layer wallet address used as the `?asset=` query target. */
  demoAsset: Address;
}

interface RunnerState {
  history: bigint[];
}

const SLIPPAGE_BPS = 500n; // 5% — agents + mover all move price between sim and swap
const HISTORY_MAX = 20;

/**
 * Runs a single strategy on a loop. Each tick:
 *   1. Sample AMM spot, append to history.
 *   2. Fetch agent's bUSD + MOCK-X balances.
 *   3. Call strategy.decide() → Decision.
 *   4. If buy/sell, pre-approve, swap, record on-chain.
 */
export class AgentRunner {
  private wallet: WalletClient;
  private rpc: PublicClient;
  private state: RunnerState = { history: [] };
  private agentName: string;

  constructor(
    private cfg: RunnerConfig,
    private strategy: Strategy
  ) {
    const account = privateKeyToAccount(cfg.privateKey);
    this.wallet = createWalletClient({
      account,
      chain: xLayerTestnet,
      transport: http(cfg.rpcUrl),
    });
    this.rpc = createPublicClient({
      chain: xLayerTestnet,
      transport: http(cfg.rpcUrl),
    }) as unknown as PublicClient;
    this.agentName = strategy.name;
  }

  get address(): Address {
    return this.wallet.account!.address;
  }

  /**
   * Registers this agent on AgentRegistry if not already registered. Idempotent
   * — silently no-ops if registered. Should be called once at startup.
   */
  async ensureRegistered(strategyLabel: string, startingCapital: bigint): Promise<void> {
    const id = (await this.rpc.readContract({
      address: this.cfg.registry,
      abi: REGISTRY_ABI,
      functionName: "agentIdOf",
      args: [this.address],
    })) as Hex;
    const existing = (await this.rpc.readContract({
      address: this.cfg.registry,
      abi: REGISTRY_ABI,
      functionName: "agents",
      args: [id],
    })) as readonly [Address, ...unknown[]];
    if (existing[0] !== "0x0000000000000000000000000000000000000000") {
      console.log(`[${this.agentName}] already registered (${this.address})`);
      return;
    }
    const hash = await this.wallet.writeContract({
      address: this.cfg.registry,
      abi: REGISTRY_ABI,
      functionName: "register",
      args: [this.agentName, strategyLabel, startingCapital],
      account: this.wallet.account!,
      chain: xLayerTestnet,
    });
    await this.rpc.waitForTransactionReceipt({ hash });
    console.log(`[${this.agentName}] registered on AgentRegistry: ${hash}`);
  }

  /** One iteration of the agent loop. Returns true if a trade was executed. */
  async tick(): Promise<{ traded: boolean; decision: Decision; spot: bigint }> {
    const spot = (await this.rpc.readContract({
      address: this.cfg.amm,
      abi: AMM_ABI,
      functionName: "spotPriceBInA",
    })) as bigint;
    this.state.history.push(spot);
    if (this.state.history.length > HISTORY_MAX) this.state.history.shift();

    const [bUSDBal, mockXBal] = await Promise.all([
      this.rpc.readContract({
        address: this.cfg.bUSD,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [this.address],
      }) as Promise<bigint>,
      this.rpc.readContract({
        address: this.cfg.mockX,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [this.address],
      }) as Promise<bigint>,
    ]);

    const decision = await this.strategy.decide({
      agent: { name: this.agentName, address: this.address, strategy: this.strategy.strategy },
      market: { spotXInBUSD: spot, history: this.state.history.slice() },
      book: { bUSD: bUSDBal, mockX: mockXBal },
      buySignal: (slug) => this.buySignal(slug),
    });

    if (decision.type === "hold") {
      console.log(`[${this.agentName}] HOLD: ${decision.reason}`);
      return { traded: false, decision, spot };
    }

    const txHash = await this.executeTrade(decision);
    console.log(
      `[${this.agentName}] ${decision.type.toUpperCase()}: ${decision.reason} → ${txHash}`
    );
    return { traded: !!txHash, decision, spot };
  }

  private async buySignal(
    slug: "wallet-risk" | "liquidity-depth" | "yield-score" | "safe-yield"
  ) {
    const url = this.cfg.signalUrls[slug];
    const expectedCost = this.cfg.signalPrices[slug];
    try {
      // Approve nothing — x402 uses transferWithAuthorization, not allowance
      const queryParam =
        slug === "wallet-risk"
          ? `address=${this.cfg.demoAsset}`
          : slug === "liquidity-depth"
            ? `tokenA=${this.cfg.bUSD}&tokenB=${this.cfg.mockX}&fee=3000`
            : `asset=${this.cfg.demoAsset}`;
      const fullUrl = `${url}?${queryParam}`;

      const res = await fetchWithPayment(fullUrl, this.wallet, undefined, {
        chainId: 1952,
        tokenResolver: () => this.cfg.busdToken,
      });
      if (!res.ok) {
        console.warn(`[${this.agentName}] signal ${slug} returned ${res.status}`);
        return null;
      }
      const data = await res.json();
      const rh = res.headers.get("X-Payment-Response");
      const settlementTx = rh
        ? (JSON.parse(Buffer.from(rh, "base64").toString()).transaction as Hex)
        : ("0x0000000000000000000000000000000000000000000000000000000000000000" as Hex);

      // Record signal consumption on-chain. Await it — running concurrently with
      // the trade flow caused nonce-race conditions on the same EOA.
      try {
        await this.recordSignal(slug, expectedCost, settlementTx);
      } catch (e) {
        console.warn(`[${this.agentName}] recordSignal failed: ${(e as Error).message}`);
      }

      return { data, cost: expectedCost, settlementTx };
    } catch (e) {
      console.warn(`[${this.agentName}] signal ${slug} error: ${(e as Error).message}`);
      return null;
    }
  }

  private async executeTrade(
    decision: Exclude<Decision, { type: "hold" }>
  ): Promise<Hex | null> {
    const isBuy = decision.type === "buy";
    const tokenIn = isBuy ? this.cfg.bUSD : this.cfg.mockX;
    const amountIn = isBuy ? decision.amountBUSD : decision.amountX;
    if (amountIn === 0n) return null;

    // Read reserves to compute expected out
    const [reserveA, reserveB] = await Promise.all([
      this.rpc.readContract({
        address: this.cfg.amm,
        abi: AMM_ABI,
        functionName: "reserveA",
      }) as Promise<bigint>,
      this.rpc.readContract({
        address: this.cfg.amm,
        abi: AMM_ABI,
        functionName: "reserveB",
      }) as Promise<bigint>,
    ]);

    const [reserveIn, reserveOut] = isBuy ? [reserveA, reserveB] : [reserveB, reserveA];
    const expectedOut = (await this.rpc.readContract({
      address: this.cfg.amm,
      abi: AMM_ABI,
      functionName: "getAmountOut",
      args: [amountIn, reserveIn, reserveOut],
    })) as bigint;
    const minOut = (expectedOut * (10_000n - SLIPPAGE_BPS)) / 10_000n;

    // Approve AMM
    const approveHash = await this.wallet.writeContract({
      address: tokenIn,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [this.cfg.amm, amountIn],
      account: this.wallet.account!,
      chain: xLayerTestnet,
    });
    await this.rpc.waitForTransactionReceipt({ hash: approveHash });

    // Swap
    const swapHash = await this.wallet.writeContract({
      address: this.cfg.amm,
      abi: AMM_ABI,
      functionName: "swap",
      args: [tokenIn, amountIn, minOut, this.address],
      account: this.wallet.account!,
      chain: xLayerTestnet,
    });
    await this.rpc.waitForTransactionReceipt({ hash: swapHash });

    // PnL approximation: amount out × spot before trade − amount in (in bUSD).
    // Negative because trading costs: each round-trip eats fees. The runner
    // computes the actual PnL by re-reading equity at the next tick.
    const pnlDelta = isBuy ? -((amountIn * 30n) / 10_000n) : -((expectedOut * 30n) / 10_000n);

    const tokenOut = isBuy ? this.cfg.mockX : this.cfg.bUSD;
    await this.recordTrade(tokenIn, amountIn, tokenOut, expectedOut, pnlDelta, swapHash);

    return swapHash;
  }

  private async recordTrade(
    tokenIn: Address,
    amountIn: bigint,
    tokenOut: Address,
    amountOut: bigint,
    pnlDelta: bigint,
    txHash: Hex
  ): Promise<void> {
    await this.wallet.writeContract({
      address: this.cfg.registry,
      abi: REGISTRY_ABI,
      functionName: "recordTrade",
      args: [tokenIn, amountIn, tokenOut, amountOut, pnlDelta, txHash],
      account: this.wallet.account!,
      chain: xLayerTestnet,
    });
  }

  private async recordSignal(slug: string, cost: bigint, settlementTx: Hex): Promise<void> {
    await this.wallet.writeContract({
      address: this.cfg.registry,
      abi: REGISTRY_ABI,
      functionName: "recordSignal",
      args: [slug, cost, settlementTx],
      account: this.wallet.account!,
      chain: xLayerTestnet,
    });
  }
}
