// Quiet Accumulation — buy deep and quiet, let the free ride do the work.
//
// Entry (evaluated on bar close, filled at next bar open):
//   1. close is at least `minDrawdown` below the all-time high so far   -- buy low
//   2. recent volume has dried up: SMA(vol, fast) <= `dryRatio` x SMA(vol, slow) -- nobody cares
//   3. no new low for `baseBars` bars: the low of the last `baseBars` bars is above the
//      low of the `baseBars` before that                               -- selling has stopped
//   4. close > EMA(`turnEma`)                                           -- first sign of a turn
// Exit:
//   - pair with the engine's `freeRideAt` (e.g. 1 = sell the cost back at 2x, keep the rest)
//   - hard stop at `stopPct` below entry
//   - once the cost is back, the tokens still traded trail `trailPct` below the highest close
//   - time stop after `maxHoldBars` if neither happened

import { ema, sma, type Candle } from "../indicators.ts";
import type { Strategy } from "../backtest/engine.ts";

export interface QuietAccumulationParams {
  minDrawdown: number;
  volFast: number;
  volSlow: number;
  dryRatio: number;
  baseBars: number;
  turnEma: number;
  stopPct: number;
  /** After the cost is back: trail the rest this far below the highest close (never below entry). */
  trailPct: number;
  maxHoldBars: number;
}

export const QUIET_DEFAULTS: QuietAccumulationParams = {
  minDrawdown: 0.7,
  volFast: 24,
  volSlow: 240,
  dryRatio: 0.5,
  baseBars: 48,
  turnEma: 20,
  stopPct: 0.5,
  trailPct: 0.35,
  maxHoldBars: 720,
};

const fmt = (v: number) => {
  const abs = Math.abs(v);
  for (const [div, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
    if (abs >= div) return `${(v / div).toPrecision(4)}${suffix}`;
  }
  return v.toPrecision(4);
};

export function quietAccumulation(params: Partial<QuietAccumulationParams> = {}): Strategy {
  const p = { ...QUIET_DEFAULTS, ...params };
  return {
    name: "Quiet Accumulation",
    prepare(c: Candle[]) {
      const closes = c.map((x) => x.close);
      const vols = c.map((x) => x.volumeUsd);
      const volFast = sma(vols, p.volFast);
      const volSlow = sma(vols, p.volSlow);
      const turn = ema(closes, p.turnEma);
      const ath: number[] = [];
      for (let i = 0, m = -Infinity; i < c.length; i++) ath.push((m = Math.max(m, c[i]!.high)));
      const lowest = (from: number, to: number) => {
        let m = Infinity;
        for (let j = Math.max(0, from); j < to; j++) m = Math.min(m, c[j]!.low);
        return m;
      };
      const warmup = Math.max(p.volSlow, p.baseBars * 2);

      const checks = (i: number) => {
        const bar = c[i]!;
        const dd = 1 - bar.close / ath[i]!;
        const dry = volFast[i]! / volSlow[i]!;
        const recentLow = lowest(i - p.baseBars + 1, i + 1);
        const priorLow = lowest(i - 2 * p.baseBars + 1, i - p.baseBars + 1);
        return [
          { label: `≥ ${p.minDrawdown * 100}% below ATH`, ok: dd >= p.minDrawdown, detail: `-${(dd * 100).toFixed(0)}%` },
          { label: `Volume dried up (≤ ${p.dryRatio}x)`, ok: dry <= p.dryRatio, detail: `${dry.toFixed(2)}x` },
          { label: `No new low in ${p.baseBars} bars`, ok: recentLow > priorLow, detail: `${fmt(recentLow)} vs ${fmt(priorLow)}` },
          { label: `Close > EMA${p.turnEma}`, ok: bar.close > turn[i]!, detail: `${fmt(bar.close)} vs ${fmt(turn[i]!)}` },
        ];
      };

      return {
        indicators: [{ name: `EMA${p.turnEma}`, values: turn, color: "#f5a623", pane: "price" }],
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
          // House money can run as long as the trail allows.
          return !pos.costRecovered && i - pos.entryIndex >= p.maxHoldBars;
        },
        conditions(i) {
          return i >= warmup ? checks(i) : [];
        },
      };
    },
  };
}
