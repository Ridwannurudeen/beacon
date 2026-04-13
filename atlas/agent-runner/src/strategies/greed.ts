import type { Strategy } from "./types.js";

/**
 * Greed — mean reverter. Buys when MOCK-X is below a recent moving average,
 * sells when it's above. Eats Fear's lunch in chop, gets crushed by trends.
 * Also doesn't pay for signals — naive price stats only.
 */
export const greed: Strategy = {
  name: "Greed",
  strategy: "mean-reversion",
  async decide({ market, book }) {
    if (market.history.length < 5) return { type: "hold", reason: "warming up" };

    const window = market.history.slice(-5);
    const sum = window.reduce((a, b) => a + b, 0n);
    const avg = sum / BigInt(window.length);
    const now = market.spotXInBUSD;

    if (avg === 0n) return { type: "hold", reason: "no avg" };
    const deviation = ((now - avg) * 10_000n) / avg;

    if (deviation < -50n && book.bUSD > 1_000_000n) {
      const size = book.bUSD / 5n;
      return { type: "buy", amountBUSD: size, reason: `mean-revert ${deviation} bps below avg` };
    }
    if (deviation > 50n && book.mockX > 1_000_000n) {
      const size = book.mockX / 5n;
      return { type: "sell", amountX: size, reason: `mean-revert ${deviation} bps above avg` };
    }
    return { type: "hold", reason: `near mean (${deviation} bps)` };
  },
};
