/**
 * MarketMover — a synthetic noise generator that creates AMM price action so
 * Fear/Greed/Skeptic have something to trade against. Runs in the same process
 * as the agents (lower latency, simpler deploy).
 *
 * Behavior: every N ticks, picks a side (50/50) and a size (small), executes a
 * swap on DemoAMM from a dedicated mover wallet. This simulates external
 * market participants the agents react to.
 *
 * The mover is NOT one of the competing strategies — its trades aren't
 * recorded on AgentRegistry and don't show up on the leaderboard.
 */
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
import { xLayerTestnet } from "@beacon/sdk";
import { ERC20_ABI, AMM_ABI } from "./abi.js";

export interface MoverConfig {
  privateKey: Hex;
  bUSD: Address;
  mockX: Address;
  amm: Address;
  rpcUrl: string;
  /** Min trade size in base units. */
  minSize: bigint;
  /** Max trade size in base units. */
  maxSize: bigint;
}

export class MarketMover {
  private wallet: WalletClient;
  private rpc: PublicClient;
  private side: "buy" | "sell" = "buy";

  constructor(private cfg: MoverConfig) {
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
  }

  get address(): Address {
    return this.wallet.account!.address;
  }

  /**
   * Executes one synthetic trade. Picks a random size in [min, max], alternates
   * sides with ~30% chance of repeat (creates short trends).
   */
  async tick(): Promise<{ side: "buy" | "sell"; size: bigint; tx: Hex }> {
    // Slight bias to repeat last side → creates trends, which Fear can ride
    if (Math.random() > 0.3) this.side = this.side === "buy" ? "sell" : "buy";

    const range = this.cfg.maxSize - this.cfg.minSize;
    const size = this.cfg.minSize + BigInt(Math.floor(Math.random() * Number(range)));
    const tokenIn = this.side === "buy" ? this.cfg.bUSD : this.cfg.mockX;

    // Approve
    const approveHash = await this.wallet.writeContract({
      address: tokenIn,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [this.cfg.amm, size],
      account: this.wallet.account!,
      chain: xLayerTestnet,
    });
    await this.rpc.waitForTransactionReceipt({ hash: approveHash });

    // Swap with 5% slippage tolerance (mover doesn't care, just creates pressure)
    const swapHash = await this.wallet.writeContract({
      address: this.cfg.amm,
      abi: AMM_ABI,
      functionName: "swap",
      args: [tokenIn, size, 0n, this.address],
      account: this.wallet.account!,
      chain: xLayerTestnet,
    });
    await this.rpc.waitForTransactionReceipt({ hash: swapHash });

    return { side: this.side, size, tx: swapHash };
  }
}
