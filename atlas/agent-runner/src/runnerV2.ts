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
import {
  decodeCascadeReceiptHeader,
  fetchWithPayment,
  xLayerTestnet,
  type SettlementToken,
  type SignedCascadeReceipt,
} from "@beacon/sdk";
import type { Strategy, Decision } from "./strategies/types.js";
import { ERC20_ABI, AMM_ABI } from "./abi.js";

/**
 * V2 AgentRunner — thin submitter. Reads strategy + AMM state, runs off-chain
 * strategy logic, dispatches signed TradeIntents to the strategy contract's
 * `submitAction`. All asset movement is on-chain through the strategy; this
 * process has zero custody.
 *
 * Skeptic restores the x402 signal-buying loop: buys Beacon's safe-yield
 * composite via fetchWithPayment using its own executor wallet, decodes the
 * signed CascadeReceipt from the response header, and submits it to
 * CascadeLedger so the upstream fan-out is provably anchored on-chain.
 */

export interface RunnerV2Config {
  executorPrivateKey: Hex;
  strategy: Address;
  asset: Address;
  other: Address;
  amm: Address;
  cascadeLedger: Address;
  rpcUrl: string;
  /** Beacon composite URL the strategy will poll on significant moves. */
  signalUrl?: string;
  /** Settlement token descriptor for x402 payment signing. */
  busdToken?: SettlementToken;
  /** Signal call price, base units. Used for logging only. */
  signalPrice?: bigint;
  /** Demo asset the composite expects as ?asset=… parameter. */
  demoAsset?: Address;
  chainId?: number;
  /** When true, buySignal() actually calls out to Beacon. Skeptic=true. */
  consumesSignals?: boolean;
}

const STRATEGY_ABI = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function submitAction(bytes actionData)",
  "function subWallet() view returns (address)",
  "function totalDebt() view returns (uint256)",
  "function name() view returns (string)",
]);

const LEDGER_ABI = parseAbi([
  "struct UpstreamPayment { string slug; address author; uint256 amount; bytes32 settlementTx; }",
  "struct CascadeReceipt { address composite; bytes32 receiptId; address buyer; uint256 buyerAmount; address settlementToken; bytes32 buyerSettlementTx; UpstreamPayment[] upstreams; uint256 timestamp; uint256 chainId; }",
  "function submit((address,bytes32,address,uint256,address,bytes32,(string,address,uint256,bytes32)[],uint256,uint256) receipt, bytes signature)",
  "function submitted(bytes32) view returns (bool)",
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
        address: this.cfg.asset,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [this.subWalletAddr],
      }) as Promise<bigint>,
      this.rpc.readContract({
        address: this.cfg.other,
        abi: ERC20_ABI,
        functionName: "balanceOf",
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

  /**
   * Purchase a Beacon composite signal via x402. Active only when
   * `consumesSignals` is true (Skeptic). Decodes the signed CascadeReceipt
   * from the response and submits it to CascadeLedger so the upstream
   * fan-out is provably anchored on-chain.
   */
  private async buySignal(
    slug: "wallet-risk" | "liquidity-depth" | "yield-score" | "safe-yield"
  ): Promise<{ data: unknown; cost: bigint; settlementTx: Hex } | null> {
    if (!this.cfg.consumesSignals) return null;
    if (!this.cfg.signalUrl || !this.cfg.busdToken) return null;
    if (slug !== "safe-yield") return null;

    try {
      const url = new URL(this.cfg.signalUrl);
      url.searchParams.set("asset", this.cfg.demoAsset ?? this.cfg.asset);
      const res = await fetchWithPayment(url.toString(), this.wallet, undefined, {
        chainId: this.cfg.chainId ?? 1952,
        tokenResolver: () => this.cfg.busdToken!,
      });
      if (!res.ok) {
        console.warn(`[${this.strategy.name}] safe-yield ${res.status}`);
        return null;
      }
      const data = await res.json();

      const header = res.headers.get("X-Cascade-Receipt");
      const hdrNames = Array.from(res.headers.keys()).join(",");
      console.log(`[${this.strategy.name}] response headers: ${hdrNames}`);
      let settlementTx: Hex = ("0x" + "00".repeat(32)) as Hex;
      if (header) {
        console.log(`[${this.strategy.name}] got receipt header (${header.length}b)`);
        try {
          const signed = decodeCascadeReceiptHeader(header);
          settlementTx = signed.receipt.buyerSettlementTx;
          await this.anchorReceipt(signed);
        } catch (e) {
          console.warn(`[${this.strategy.name}] receipt decode: ${(e as Error).message}`);
        }
      } else {
        console.warn(`[${this.strategy.name}] no X-Cascade-Receipt header in response`);
      }
      return {
        data,
        cost: this.cfg.signalPrice ?? 6000n,
        settlementTx,
      };
    } catch (e) {
      console.warn(`[${this.strategy.name}] buySignal ${slug} error: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Submit a signed CascadeReceipt to the on-chain ledger. Best-effort and
   * idempotent — if the ledger has already seen this receipt, no-op.
   */
  private async anchorReceipt(signed: SignedCascadeReceipt): Promise<void> {
    try {
      const already = (await this.rpc.readContract({
        address: this.cfg.cascadeLedger,
        abi: LEDGER_ABI,
        functionName: "submitted",
        args: [signed.receipt.receiptId],
      })) as boolean;
      if (already) return;

      const receiptTuple = [
        signed.receipt.composite,
        signed.receipt.receiptId,
        signed.receipt.buyer,
        signed.receipt.buyerAmount,
        signed.receipt.settlementToken,
        signed.receipt.buyerSettlementTx,
        signed.receipt.upstreams.map((u) => [u.slug, u.author, u.amount, u.settlementTx]) as [
          string,
          Address,
          bigint,
          Hex,
        ][],
        signed.receipt.timestamp,
        signed.receipt.chainId,
      ] as const;

      const hash = await this.wallet.writeContract({
        address: this.cfg.cascadeLedger,
        abi: LEDGER_ABI,
        functionName: "submit",
        args: [receiptTuple, signed.signature],
        account: this.wallet.account!,
        chain: xLayerTestnet,
      });
      await this.rpc.waitForTransactionReceipt({ hash });
      console.log(
        `[${this.strategy.name}] cascade anchored → ${hash} (${signed.receipt.upstreams.length} upstream payments)`
      );
    } catch (e) {
      console.warn(`[${this.strategy.name}] anchorReceipt: ${(e as Error).message}`);
    }
  }
}
