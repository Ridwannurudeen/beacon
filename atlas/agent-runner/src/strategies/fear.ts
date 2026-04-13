import type { Strategy } from "./types.js";

/**
 * Fear — momentum follower. Buys when MOCK-X price has risen sharply over the
 * last few ticks; sells when it falls sharply. Doesn't pay for signals — pure
 * price action. Will get steamrolled in chop, lights up in trends.
 */
export const fear: Strategy = {
  name: "Fear",
  strategy: "momentum",
  async decide({ market, book }) {
    if (market.history.length < 3) return { type: "hold", reason: "warming up" };

    const now = market.spotXInBUSD;
    const past = market.history[market.history.length - 3]!;
    const movePct = past === 0n ? 0n : ((now - past) * 10_000n) / past;

    // 0.3% move = 30 bps trigger
    if (movePct > 30n && book.bUSD > 1_000_000n) {
      // Buy 20% of bUSD into MOCK-X
      const size = book.bUSD / 5n;
      return { type: "buy", amountBUSD: size, reason: `momentum +${movePct} bps` };
    }
    if (movePct < -30n && book.mockX > 1_000_000n) {
      const size = book.mockX / 5n;
      return { type: "sell", amountX: size, reason: `momentum ${movePct} bps` };
    }
    return { type: "hold", reason: `flat (${movePct} bps)` };
  },
};
