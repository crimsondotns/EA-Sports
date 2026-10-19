// Quiet Accumulation — buy a held support after a deep drop, let the free ride do the work.
//
// Support / resistance come from swing pivots: lows (highs) that are the lowest (highest) of
// `pivotBars` bars on each side, grouped into zones when they sit within `zoneTol` of each
// other. A pivot only counts once `pivotBars` bars have closed after it (no look-ahead).
//
// Entry (evaluated on bar close, filled at next bar open):
//   1. close is at least `minDrawdown` below the all-time high so far        -- buy low
//   2. the bar tested a support zone touched >= `minTouches` times and closed back above it
//   3. reversal candle: green and closing above the previous bar's high      -- buyers step in
//   4. selling has faded: SMA(vol, fast) <= `dryRatio` x SMA(vol, slow)        -- quiet
// Exit:
//   - stop just under the support zone (`stopAtr` x ATR below its low)
//   - pair with the engine's `freeRideAt` / `freeRideKeep` for the cost back and free tokens
//   - once the cost is back, the tokens still traded trail `trailPct` below the highest close
//   - time stop once `maxHoldBars` bars of time have passed (by the clock) if the cost never came back

import { atr, barInterval, clusterZones, pivotHighs, pivotLows, sma, type Candle, type Pivot, type Zone } from "../indicators.ts";
import type { Strategy } from "../backtest/engine.ts";

export interface QuietAccumulationParams {
  minDrawdown: number;
  volFast: number;
  volSlow: number;
  dryRatio: number;
  pivotBars: number;
  zoneTol: number;
  minTouches: number;
  /** Only pivots from the last this-many bars form zones. */
  srLookback: number;
  atrPeriod: number;
  stopAtr: number;
  trailPct: number;
  maxHoldBars: number;
}

export const QUIET_DEFAULTS: QuietAccumulationParams = {
  minDrawdown: 0.4,
  volFast: 24,
  volSlow: 120,
  dryRatio: 0.8,
  pivotBars: 5,
  zoneTol: 0.04,
  minTouches: 2,
  srLookback: 720,
  atrPeriod: 14,
  stopAtr: 0.5,
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
      const vols = c.map((x) => x.volumeUsd);
      const volFast = sma(vols, p.volFast);
      const volSlow = sma(vols, p.volSlow);
      const atrs = atr(c, p.atrPeriod);
      const ath: number[] = [];
      for (let i = 0, m = -Infinity; i < c.length; i++) ath.push((m = Math.max(m, c[i]!.high)));
      const lows = pivotLows(c, p.pivotBars);
      const highs = pivotHighs(c, p.pivotBars);
      const holdMs = p.maxHoldBars * barInterval(c);
      const warmup = Math.max(p.volSlow, p.atrPeriod, p.pivotBars * 4);

      // Zones known at the close of bar i: pivots confirmed by then, within the lookback.
      const known = (pivots: Pivot[], i: number) =>
        pivots.filter((x) => x.index + p.pivotBars <= i && x.index >= i - p.srLookback);
      const cache = new Map<number, { supports: Zone[]; resistances: Zone[] }>();
      const zonesAt = (i: number) => {
        let z = cache.get(i);
        if (!z) {
          z = {
            supports: clusterZones(known(lows, i), p.zoneTol).filter((x) => x.touches >= p.minTouches),
            resistances: clusterZones(known(highs, i), p.zoneTol).filter((x) => x.touches >= p.minTouches),
          };
          cache.set(i, z);
        }
        return z;
      };
      /** The support this bar tested and held: low reached into it, close stayed above its low. */
      const testedSupport = (i: number) => {
        const bar = c[i]!;
        return zonesAt(i)
          .supports.filter((z) => bar.low <= z.high * (1 + p.zoneTol) && bar.close >= z.low)
          .sort((a, b) => b.touches - a.touches || b.high - a.high)[0];
      };

      const checks = (i: number) => {
        const bar = c[i]!;
        const prev = c[i - 1]!;
        const dd = 1 - bar.close / ath[i]!;
        const zone = testedSupport(i);
        const dry = volFast[i - 1]! / volSlow[i - 1]!;
        return [
          { label: `≥ ${p.minDrawdown * 100}% below ATH`, ok: dd >= p.minDrawdown, detail: `-${(dd * 100).toFixed(0)}%` },
          {
            label: `Held support (${p.minTouches}+ touches)`,
            ok: !!zone,
            detail: zone ? `${fmt(zone.low)}–${fmt(zone.high)} ×${zone.touches}` : "none",
          },
          {
            label: "Reversal candle",
            ok: bar.close > bar.open && bar.close > prev.high,
            detail: `${fmt(bar.close)} vs ${fmt(prev.high)}`,
          },
          { label: `Selling faded (≤ ${p.dryRatio}x)`, ok: dry <= p.dryRatio, detail: `${dry.toFixed(2)}x` },
        ];
      };

      return {
        shouldEnter(i) {
          return i >= warmup && checks(i).every((x) => x.ok);
        },
        initialStop(i, entryPrice) {
          const zone = testedSupport(i);
          const stop = zone ? zone.low - p.stopAtr * atrs[i]! : entryPrice * 0.7;
          return Math.min(stop, entryPrice * 0.97);
        },
        updateStop(_i, pos) {
          if (!pos.costRecovered) return pos.stop;
          return Math.max(pos.stop, pos.entryPrice, pos.highestClose * (1 - p.trailPct));
        },
        shouldTimeExit(i, pos) {
          // House money can run as long as the trail allows.
          return !pos.costRecovered && c[i]!.time - c[pos.entryIndex]!.time >= holdMs;
        },
        conditions(i) {
          return i >= warmup ? checks(i) : [];
        },
        plan(i) {
          if (i < warmup) return null;
          const close = c[i]!.close;
          // Deep enough to satisfy the drawdown rule, and below the current price.
          const maxEntry = ath[i]! * (1 - p.minDrawdown);
          const zone = zonesAt(i)
            .supports.filter((z) => z.low <= Math.min(close, maxEntry))
            .sort((a, b) => b.high - a.high)[0];
          if (!zone) return null;
          const high = Math.min(zone.high * (1 + p.zoneTol), maxEntry, close);
          return {
            kind: "zone" as const,
            low: zone.low,
            high,
            stop: zone.low - p.stopAtr * atrs[i]!,
            waitFor: `support ×${zone.touches} — wait for a green candle closing above the previous high`,
          };
        },
        levels(i) {
          const { supports, resistances } = zonesAt(i);
          const price = c[i]!.close;
          // Nearest few on each side of the current price.
          const sup = supports.filter((z) => z.low <= price).sort((a, b) => b.high - a.high).slice(0, 3);
          const res = resistances.filter((z) => z.high >= price).sort((a, b) => a.low - b.low).slice(0, 3);
          return [
            ...sup.map((z) => ({ kind: "support" as const, price: (z.low + z.high) / 2, touches: z.touches, from: z.from })),
            ...res.map((z) => ({ kind: "resistance" as const, price: (z.low + z.high) / 2, touches: z.touches, from: z.from })),
          ];
        },
      };
    },
  };
}
