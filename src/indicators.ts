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

export interface Pivot {
  index: number;
  price: number;
}

/**
 * Swing lows: bars whose low is the lowest of the `k` bars on each side. A pivot at index p
 * is only known once bar p + k has closed, so callers must not use it before then.
 */
export function pivotLows(c: Candle[], k: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = k; i < c.length - k; i++) {
    let ok = true;
    for (let j = i - k; j <= i + k && ok; j++) if (j !== i && c[j]!.low < c[i]!.low) ok = false;
    if (ok) out.push({ index: i, price: c[i]!.low });
  }
  return out;
}

/** Swing highs, mirror of `pivotLows`. */
export function pivotHighs(c: Candle[], k: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = k; i < c.length - k; i++) {
    let ok = true;
    for (let j = i - k; j <= i + k && ok; j++) if (j !== i && c[j]!.high > c[i]!.high) ok = false;
    if (ok) out.push({ index: i, price: c[i]!.high });
  }
  return out;
}

export interface Zone {
  low: number;
  high: number;
  touches: number;
  /** Index of the first pivot in the zone. */
  from: number;
}

/** Groups pivot prices that sit within `tol` (fraction) of each other into zones. */
export function clusterZones(pivots: Pivot[], tol: number): Zone[] {
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const zones: Zone[] = [];
  for (const p of sorted) {
    const z = zones.at(-1);
    if (z && p.price <= z.low * (1 + tol)) {
      z.high = Math.max(z.high, p.price);
      z.touches++;
      z.from = Math.min(z.from, p.index);
    } else zones.push({ low: p.price, high: p.price, touches: 1, from: p.index });
  }
  return zones;
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    if (i <= period) {
      gain += Math.max(d, 0) / period;
      loss += Math.max(-d, 0) / period;
      if (i < period) continue;
    } else {
      gain = (gain * (period - 1) + Math.max(d, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    }
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

/** MACD line, signal line and histogram (line − signal). */
export function macd(values: number[], fast = 12, slow = 26, signal = 9): { line: number[]; signal: number[]; hist: number[] } {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = values.map((_, i) => f[i]! - s[i]!);
  // The signal EMA starts once the MACD line exists.
  const sig = new Array<number>(values.length).fill(NaN);
  const start = slow - 1;
  ema(line.slice(start), signal).forEach((v, k) => (sig[start + k] = v));
  return { line, signal: sig, hist: line.map((v, i) => v - sig[i]!) };
}

/**
 * The chart's bar length in ms: the smallest gap between bars. DEX Screener skips bars with no
 * trades, so counting bars undercounts time on quiet pairs; use this to measure time instead.
 */
export function barInterval(c: Candle[]): number {
  let min = Infinity;
  for (let i = 1; i < c.length; i++) {
    const d = c[i]!.time - c[i - 1]!.time;
    if (d > 0 && d < min) min = d;
  }
  return Number.isFinite(min) ? min : 60_000;
}
