import type { Address } from "viem";

/**
 * Agent context passed to a strategy on every tick. Strategies are pure: given
 * the context, return a Decision. Side effects (signal calls, swaps, on-chain
 * recording) happen in the runner, which keeps strategies easy to test and to
 * port between agents.
 */
export interface AgentContext {
  agent: {
    name: string;
    address: Address;
    strategy: string;
  };
  market: {
    /** Current spot price of MOCK-X in bUSD, scaled to 1e18. */
    spotXInBUSD: bigint;
    /** Recent spot history (newest last), at least 2 entries. */
    history: bigint[];
  };
  book: {
    bUSD: bigint; // current balance, base units
    mockX: bigint; // current balance, base units
  };
  /**
   * Buy intelligence from the Beacon signal layer. Strategies CAN choose to
   * skip this — every signal call costs bUSD and shows up as drag on PnL.
   * Skeptic uses signals heavily; Fear and Greed don't bother.
   */
  buySignal: (slug: "wallet-risk" | "liquidity-depth" | "yield-score" | "safe-yield") => Promise<{
    data: unknown;
    cost: bigint;
    settlementTx: `0x${string}`;
  } | null>;
}

export type Decision =
  | { type: "buy"; amountBUSD: bigint; reason: string }
  | { type: "sell"; amountX: bigint; reason: string }
  | { type: "hold"; reason: string };

export interface Strategy {
  name: string;
  strategy: string;
  decide: (ctx: AgentContext) => Promise<Decision>;
}
