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

// All series are aligned with the input; NaN until enough data.

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else if (i >= period) {
      prev = values[i]! * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

/** Wilder's ATR. */
export function atr(c: Candle[], period: number): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  let prev = NaN;
  let sum = 0;
  for (let i = 0; i < c.length; i++) {
    const tr =
      i === 0
        ? c[i]!.high - c[i]!.low
        : Math.max(c[i]!.high - c[i]!.low, Math.abs(c[i]!.high - c[i - 1]!.close), Math.abs(c[i]!.low - c[i - 1]!.close));
    if (i < period) {
      sum += tr;
      if (i === period - 1) prev = sum / period;
    } else {
      prev = (prev * (period - 1) + tr) / period;
    }
    out[i] = prev;
  }
  return out;
}

/** Highest high of the `period` bars before i (excludes bar i). */
export function priorHighest(c: Candle[], period: number): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  for (let i = period; i < c.length; i++) {
    let m = -Infinity;
    for (let j = i - period; j < i; j++) m = Math.max(m, c[j]!.high);
    out[i] = m;
  }
  return out;
}
