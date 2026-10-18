// Deep Dip — buy while the price is still under every EMA, as MACD turns up from below zero.
//
// Entry (evaluated on bar close, filled at next bar open):
//   1. close below EMA 9, EMA 21 and EMA 200                                   -- still cheap
//   2. MACD line and signal line both below the histogram                      -- selling is
//      (histogram = line − signal, so this means signal < 0 and line > 2 × signal:  running out
//      below zero, with the line no longer falling far under the signal)
//   3. RSI <= `maxRsi` (under 50, or above it by no more than 10)              -- not chased
// Exit:
//   - fixed stop `stopPct` below the entry
//   - pair with the engine's `freeRideAt` / `freeRideKeep` for the cost back and free tokens
//   - once the cost is back, the tokens still traded trail `trailPct` below the highest close
//   - time stop after `maxHoldBars` if the cost never came back

import { ema, macd, rsi, type Candle } from "../indicators.ts";
import type { Strategy } from "../backtest/engine.ts";

export interface DeepDipParams {
  emaFast: number;
  emaMid: number;
  emaSlow: number;
  maxRsi: number;
  stopPct: number;
  trailPct: number;
  maxHoldBars: number;
}

export const DEEP_DIP_DEFAULTS: DeepDipParams = {
  emaFast: 9,
  emaMid: 21,
  emaSlow: 200,
  maxRsi: 60,
  stopPct: 0.2,
  trailPct: 0.35,
  maxHoldBars: 2880,
};

const fmt = (v: number) => {
  const abs = Math.abs(v);
  for (const [div, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
    if (abs >= div) return `${(v / div).toPrecision(4)}${suffix}`;
  }
  return v.toPrecision(4);
};

export function deepDip(params: Partial<DeepDipParams> = {}): Strategy {
  const p = { ...DEEP_DIP_DEFAULTS, ...params };
  return {
    name: "Deep Dip",
    prepare(c: Candle[]) {
      const close = c.map((x) => x.close);
      const e1 = ema(close, p.emaFast);
      const e2 = ema(close, p.emaMid);
      const e3 = ema(close, p.emaSlow);
      const m = macd(close);
      const r = rsi(close);
      const warmup = p.emaSlow + 1;

      const checks = (i: number) => {
        const px = close[i]!;
        const h = m.hist[i]!;
        return [
          {
            label: `Below EMA ${p.emaFast} / ${p.emaMid} / ${p.emaSlow}`,
            ok: px < e1[i]! && px < e2[i]! && px < e3[i]!,
            detail: `${fmt(px)} vs ${fmt(Math.min(e1[i]!, e2[i]!, e3[i]!))}`,
          },
          {
            label: "MACD & signal below histogram",
            ok: m.line[i]! < h && m.signal[i]! < h,
            detail: `hist ${h > 0 ? "+" : ""}${fmt(h)}`,
          },
          { label: `RSI ≤ ${p.maxRsi}`, ok: r[i]! <= p.maxRsi, detail: r[i]!.toFixed(0) },
        ];
      };

      return {
        shouldEnter(i) {
          return i >= warmup && checks(i).every((x) => x.ok);
        },
        initialStop(_i, entryPrice) {
          return entryPrice * (1 - p.stopPct);
        },
        updateStop(_i, pos) {
          if (!pos.costRecovered) return pos.stop;
          return Math.max(pos.stop, pos.entryPrice, pos.highestClose * (1 - p.trailPct));
        },
        shouldTimeExit(i, pos) {
          return !pos.costRecovered && i - pos.entryIndex >= p.maxHoldBars;
        },
        conditions(i) {
          return i >= warmup ? checks(i) : [];
        },
        plan(i) {
          if (i < warmup) return null;
          // Price has to be under the lowest of the three EMAs; then MACD and RSI decide the bar.
          const high = Math.min(e1[i]!, e2[i]!, e3[i]!);
          return {
            kind: "below" as const,
            low: high,
            high,
            stop: high * (1 - p.stopPct),
            waitFor: `under all EMAs — wait for MACD & signal below the histogram, RSI ≤ ${p.maxRsi}`,
          };
        },
      };
    },
  };
}
