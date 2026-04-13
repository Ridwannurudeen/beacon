import type { Strategy } from "./types.js";

/**
 * Skeptic — intelligence-driven. Before every potential trade, queries the
 * Beacon `safe-yield` composite signal (which itself cascades to wallet-risk,
 * liquidity-depth, yield-score). Uses the safetyScore as a sizing dial — high
 * safety → bigger trades; low safety → smaller or no trades.
 *
 * Trade-off: signal costs reduce PnL on every trade. Bet is that better
 * decisions outweigh the cost. The cascade is now economically meaningful —
 * if Skeptic's signal-informed trades aren't actually better than Fear's
 * naive momentum, the data is overpriced.
 */
export const skeptic: Strategy = {
  name: "Skeptic",
  strategy: "intelligence-driven",
  async decide({ market, book, buySignal }) {
    if (market.history.length < 3) return { type: "hold", reason: "warming up" };

    // Skeptic only trades when there's a clear edge AND the signal endorses it.
    const now = market.spotXInBUSD;
    const past = market.history[market.history.length - 3]!;
    const movePct = past === 0n ? 0n : ((now - past) * 10_000n) / past;

    if (movePct > -25n && movePct < 25n) {
      return { type: "hold", reason: `no edge (${movePct} bps), saving signal cost` };
    }

    // Buy intelligence
    const result = await buySignal("safe-yield");
    if (!result) return { type: "hold", reason: "signal unavailable" };

    const data = result.data as { output?: { safetyScore?: number; recommendation?: string } };
    const score = data.output?.safetyScore ?? 50;
    const rec = data.output?.recommendation ?? "hold";

    if (rec === "hold") {
      return { type: "hold", reason: `signal says hold (safety ${score})` };
    }

    // Size based on safety score (50→small, 100→full)
    const sizeFactor = BigInt(Math.max(20, score)); // 20–100 bps factor → / 1000

    if (movePct > 0n && book.bUSD > 1_000_000n) {
      const size = (book.bUSD * sizeFactor) / 1000n;
      return { type: "buy", amountBUSD: size, reason: `signal-sized buy (safety ${score})` };
    }
    if (movePct < 0n && book.mockX > 1_000_000n) {
      const size = (book.mockX * sizeFactor) / 1000n;
      return { type: "sell", amountX: size, reason: `signal-sized sell (safety ${score})` };
    }
    return { type: "hold", reason: `no opportunity (safety ${score})` };
  },
};
