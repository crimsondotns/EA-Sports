// Deep Dip — buy while the price is still under every EMA, as MACD turns up from below zero.
//
// Entry (evaluated on bar close, filled at next bar open):
//   1. close below EMA 9, EMA 21 and EMA 200                                   -- still cheap
//      (EMA 200 is skipped until it exists, so young pairs can trade: 200 bars is 33 days on 4h)
//   2. MACD line and signal line both below the histogram                      -- selling is
//      (histogram = line − signal, so this means signal < 0 and line > 2 × signal:  running out
//      below zero, with the line no longer falling far under the signal)
//   3. `minRsi` < RSI <= `maxRsi` (30–60): not still in free fall, not chased
//      and RSI is at least `rsiBounce` (20%) above its lowest of the last `rsiLowBars` bars
//   4. support, two cases:
//      a. there is a support zone (`minTouches`+ swing lows) below the price: the bar must
//         have tested it and closed back above its low -- buy at the support, not above it
//      b. no support below the price (e.g. a new low): rules 1–3 are enough
// Exit:
//   - fixed stop `stopPct` below the entry, in both cases. A stop just under the support zone
//     was tested too: across 40 pairs it got shaken out and re-entered far more often (15m:
//     3,544 trades vs 1,523, worst pair −60% vs −16%)
//   - pair with the engine's `freeRideAt` / `freeRideKeep` for the cost back and free tokens
//   - once the cost is back, the tokens still traded trail `trailPct` below the highest close
//   - time stop after `maxHoldBars` if the cost never came back

import { clusterZones, ema, macd, pivotLows, rsi, type Candle, type Zone } from "../indicators.ts";
import type { Strategy } from "../backtest/engine.ts";

export interface DeepDipParams {
  emaFast: number;
  emaMid: number;
  emaSlow: number;
  /** RSI must be above this: under 30 the selling usually isn't done yet. */
  minRsi: number;
  maxRsi: number;
  /** RSI must be this fraction above its recent low (0.2: low 25 needs 30); 0 turns the rule off.
   *  +20 points was tried too: it waits until the bounce is mostly over (15m median +17.7% vs +33.1%). */
  rsiBounce: number;
  rsiLowBars: number;
  /** Require the support test when a support exists (case a). Off: rules 1–3 only. */
  useSupport: boolean;
  pivotBars: number;
  zoneTol: number;
  minTouches: number;
  /** Only swing lows from the last this-many bars form support zones. */
  srLookback: number;
  /**
   * Re-entry after a failed buy: if an earlier signal within `reentryBars` closed above the
   * current price (that buy is likely stopped out, the downtrend goes on), only buy again on
   * a bullish divergence -- a lower price with RSI at least `divergenceRsi` points higher than
   * at that signal. "off" re-enters on the normal rules.
   * Off by default: across 40 pairs (15m) every variant cut the median return from +35% to
   * +13–16%, because many of the big winners are exactly those lower re-entries.
   */
  reentry: "off" | "divergence" | "skip";
  reentryBars: number;
  divergenceRsi: number;
  stopPct: number;
  trailPct: number;
  maxHoldBars: number;
}

export const DEEP_DIP_DEFAULTS: DeepDipParams = {
  emaFast: 9,
  emaMid: 21,
  emaSlow: 200,
  minRsi: 30,
  maxRsi: 60,
  rsiBounce: 0.2,
  rsiLowBars: 96,
  useSupport: true,
  pivotBars: 5,
  zoneTol: 0.04,
  minTouches: 2,
  srLookback: 2880,
  reentry: "off",
  reentryBars: 2880,
  divergenceRsi: 3,
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
      const lows = pivotLows(c, p.pivotBars);
      // MACD's signal line is the slowest series that must exist; EMA 200 joins when it can.
      const warmup = Math.max(p.emaMid, 26 + 9) + 1;
      /** The lowest of the EMAs that exist at bar i: the price has to be under it. */
      const emaFloor = (i: number) => Math.min(e1[i]!, e2[i]!, Number.isFinite(e3[i]!) ? e3[i]! : Infinity);

      // Support zones known at the close of bar i (pivots confirmed by then), below its close.
      const cache = new Map<number, Zone[]>();
      const supportsBelow = (i: number) => {
        let z = cache.get(i);
        if (!z) {
          const known = lows.filter((x) => x.index + p.pivotBars <= i && x.index >= i - p.srLookback);
          z = clusterZones(known, p.zoneTol).filter((x) => x.touches >= p.minTouches && x.low <= close[i]!);
          cache.set(i, z);
        }
        return z;
      };
      /** Case a: the support the bar tested and held. undefined = none tested; null = no support at all. */
      const support = (i: number): Zone | undefined | null => {
        const zones = supportsBelow(i);
        if (!zones.length) return null;
        const bar = c[i]!;
        return zones
          .filter((z) => bar.low <= z.high * (1 + p.zoneTol) && bar.close >= z.low)
          .sort((a, b) => b.touches - a.touches || b.high - a.high)[0];
      };

      const indicatorChecks = (i: number) => {
        const px = close[i]!;
        const h = m.hist[i]!;
        const rv = r[i]!;
        return [
          {
            label: `Below EMA ${p.emaFast} / ${p.emaMid} / ${p.emaSlow}`,
            ok: px < emaFloor(i),
            detail: `${fmt(px)} vs ${fmt(emaFloor(i))}${Number.isFinite(e3[i]!) ? "" : ` (no EMA ${p.emaSlow} yet)`}`,
          },
          {
            label: "MACD & signal below histogram",
            ok: m.line[i]! < h && m.signal[i]! < h,
            detail: `hist ${h > 0 ? "+" : ""}${fmt(h)}`,
          },
          {
            label: `RSI ${p.minRsi}–${p.maxRsi}`,
            ok: rv > p.minRsi && rv <= p.maxRsi,
            detail: rv.toFixed(0),
          },
          ...(p.rsiBounce > 0
            ? (() => {
                let low = Infinity;
                for (let k = Math.max(0, i - p.rsiLowBars + 1); k <= i; k++) if (Number.isFinite(r[k])) low = Math.min(low, r[k]!);
                return [
                  {
                    label: `RSI +${p.rsiBounce * 100}% off its low`,
                    ok: rv >= low * (1 + p.rsiBounce),
                    detail: `${low.toFixed(0)} → ${rv.toFixed(0)} (+${((rv / low - 1) * 100).toFixed(0)}%)`,
                  },
                ];
              })()
            : []),
        ];
      };
      const checks = (i: number) => {
        const base = indicatorChecks(i);
        if (!p.useSupport) return base;
        const z = support(i);
        return [
          ...base,
          {
            label: "At support (or none below)",
            ok: z !== undefined,
            detail: z ? `${fmt(z.low)}–${fmt(z.high)} ×${z.touches}` : z === null ? "no support below" : "not at support",
          },
        ];
      };

      // Last bar that signalled; the engine only asks while flat, in time order.
      let lastSignal = -1;
      /** Re-entry rule: false when an earlier, higher signal failed and this bar doesn't diverge. */
      const reentryOk = (i: number) => {
        if (p.reentry === "off" || lastSignal < 0 || i - lastSignal > p.reentryBars) return true;
        if (close[i]! >= close[lastSignal]!) return true;
        return p.reentry === "divergence" && r[i]! >= r[lastSignal]! + p.divergenceRsi;
      };

      return {
        shouldEnter(i) {
          // Indicators first: the support search is the expensive part.
          if (i < warmup || !indicatorChecks(i).every((x) => x.ok)) return false;
          if (p.useSupport && support(i) === undefined) return false;
          if (!reentryOk(i)) return false;
          lastSignal = i;
          return true;
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
          const under = emaFloor(i);
          const waitFor = `MACD & signal below the histogram, RSI ${p.minRsi}–${p.maxRsi}`;
          // Case a: the nearest support below, capped at the EMAs so both rules can hold there.
          const zone = p.useSupport ? supportsBelow(i).sort((a, b) => b.high - a.high)[0] : undefined;
          if (zone) {
            const high = Math.min(zone.high * (1 + p.zoneTol), under, close[i]!);
            if (high > zone.low) {
              return {
                kind: "zone" as const,
                low: zone.low,
                high,
                stop: high * (1 - p.stopPct),
                waitFor: `support ×${zone.touches} under the EMAs — wait for ${waitFor}`,
              };
            }
          }
          // Case b: no support below — under the EMAs is enough.
          return { kind: "below" as const, low: under, high: under, stop: under * (1 - p.stopPct), waitFor: `under all EMAs — wait for ${waitFor}` };
        },
      };
    },
  };
}
