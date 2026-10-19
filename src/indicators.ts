import type { Bar } from "./dexscreener/bars.ts";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
}

/** `usd` falls back to quote prices for bars without USD values. */
export function toCandles(bars: Bar[], price: "quote" | "usd" = "quote"): Candle[] {
  return bars.map((b) => {
    const usd = price === "usd" && b.closeUsd !== null;
    return {
      time: b.timestamp,
      open: Number(usd ? b.openUsd : b.open),
      high: Number(usd ? b.highUsd : b.high),
      low: Number(usd ? b.lowUsd : b.low),
      close: Number(usd ? b.closeUsd : b.close),
      volumeUsd: Number(b.volumeUsd ?? 0),
    };
  });
}

