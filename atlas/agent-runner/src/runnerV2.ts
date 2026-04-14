import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "@beacon/sdk";
import type { Strategy, Decision } from "./strategies/types.js";
import { ERC20_ABI, AMM_ABI } from "./abi.js";

/**
 * V2 AgentRunner — thin submitter that reads the strategy's on-chain state,
 * runs the off-chain decision algorithm, and dispatches signed TradeIntent
 * payloads to `TradingStrategy.submitAction`. All asset movement happens
 * on-chain through the strategy contract; this process has zero custody.
 *
 * Key differences from v1:
 *   - Agent EOA = executor, not trader. Executor cannot move funds, only
 *     trigger strategy-gated trades.
 *   - `totalAssets` comes from strategy.totalAssets() on-chain, not EOA balances.
 *   - No recordTrade/recordSignal — the vault's `harvest()` is the source of
 *     truth for P&L. The UI reads AgentTraded events emitted inside the
 *     strategy's `_trade` via DemoAMM's Swap event.
 */

export interface RunnerV2Config {
  executorPrivateKey: Hex;
  strategy: Address;        // TradingStrategy contract address
  asset: Address;           // bUSD
  other: Address;           // MOCKX
  amm: Address;
  rpcUrl: string;
}

const STRATEGY_ABI = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function submitAction(bytes actionData)",
  "function subWallet() view returns (address)",
  "function totalDebt() view returns (uint256)",
  "function name() view returns (string)",
]);

const SLIPPAGE_BPS = 500n;
const HISTORY_MAX = 20;

export class AgentRunnerV2 {
  private wallet: WalletClient;
  private rpc: PublicClient;
  private history: bigint[] = [];
  private subWalletAddr!: Address;

  constructor(
    private cfg: RunnerV2Config,
    private strategy: Strategy
  ) {
    const account = privateKeyToAccount(cfg.executorPrivateKey);
    this.wallet = createWalletClient({
      account,
      chain: xLayerTestnet,
      transport: http(cfg.rpcUrl),
    });
    this.rpc = createPublicClient({
      chain: xLayerTestnet,
      transport: http(cfg.rpcUrl),
    }) as unknown as PublicClient;
  }

  get address(): Address {
    return this.wallet.account!.address;
  }

  async init(): Promise<void> {
    this.subWalletAddr = (await this.rpc.readContract({
      address: this.cfg.strategy,
      abi: STRATEGY_ABI,
      functionName: "subWallet",
    })) as Address;
  }

  async tick(): Promise<{ traded: boolean; decision: Decision; spot: bigint }> {
    const spot = (await this.rpc.readContract({
      address: this.cfg.amm,
      abi: AMM_ABI,
      functionName: "spotPriceBInA",
    })) as bigint;
    this.history.push(spot);
    if (this.history.length > HISTORY_MAX) this.history.shift();

    const [bBal, xBal] = await Promise.all([
      this.rpc.readContract({
        address: this.cfg.asset, abi: ERC20_ABI, functionName: "balanceOf",
        args: [this.subWalletAddr],
      }) as Promise<bigint>,
      this.rpc.readContract({
        address: this.cfg.other, abi: ERC20_ABI, functionName: "balanceOf",
        args: [this.subWalletAddr],
      }) as Promise<bigint>,
    ]);

    const decision = await this.strategy.decide({
      agent: { name: this.strategy.name, address: this.cfg.strategy, strategy: this.strategy.strategy },
      market: { spotXInBUSD: spot, history: this.history.slice() },
      book: { bUSD: bBal, mockX: xBal },
      buySignal: (slug) => this.buySignal(slug),
    });

    if (decision.type === "hold") {
      console.log(`[${this.strategy.name}] HOLD: ${decision.reason}`);
      return { traded: false, decision, spot };
    }

    const isBuy = decision.type === "buy";
    const amountIn = isBuy ? decision.amountBUSD : decision.amountX;
    if (amountIn === 0n) return { traded: false, decision, spot };

    // Compute minOut with slippage
    const [reserveA, reserveB] = await Promise.all([
      this.rpc.readContract({
        address: this.cfg.amm, abi: AMM_ABI, functionName: "reserveA",
      }) as Promise<bigint>,
      this.rpc.readContract({
        address: this.cfg.amm, abi: AMM_ABI, functionName: "reserveB",
      }) as Promise<bigint>,
    ]);
    const [reserveIn, reserveOut] = isBuy ? [reserveA, reserveB] : [reserveB, reserveA];
    const expectedOut = (await this.rpc.readContract({
      address: this.cfg.amm, abi: AMM_ABI, functionName: "getAmountOut",
      args: [amountIn, reserveIn, reserveOut],
    })) as bigint;
    const minOut = (expectedOut * (10_000n - SLIPPAGE_BPS)) / 10_000n;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    // Encode (bool isBuy, uint256 amountIn, uint256 minOut, uint256 deadline)
    const actionData = encodeAbiParameters(
      [
        { type: "bool" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [isBuy, amountIn, minOut, deadline]
    );

    try {
      const hash = await this.wallet.writeContract({
        address: this.cfg.strategy,
        abi: STRATEGY_ABI,
        functionName: "submitAction",
        args: [actionData],
        account: this.wallet.account!,
        chain: xLayerTestnet,
      });
      await this.rpc.waitForTransactionReceipt({ hash });
      console.log(`[${this.strategy.name}] ${decision.type.toUpperCase()}: ${decision.reason} → ${hash}`);
      return { traded: true, decision, spot };
    } catch (e) {
      console.warn(`[${this.strategy.name}] submitAction failed: ${(e as Error).message}`);
      return { traded: false, decision, spot };
    }
  }
}
