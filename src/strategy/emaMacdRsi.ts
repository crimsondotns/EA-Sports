// Deep Dip — buy while the price is still under every EMA, as MACD turns up from below zero.
//
// Entry (evaluated on bar close, filled at next bar open):
//   1. close below EMA 9, EMA 21 and EMA 200                                   -- still cheap
//      (EMA 200 is skipped until it exists, so young pairs can trade: 200 bars is 33 days on 4h)
//   2. MACD line and signal line both below the histogram                      -- selling is
//      (histogram = line − signal, so this means signal < 0 and line > 2 × signal:  running out
//      below zero, with the line no longer falling far under the signal)
//   3. `minRsi` < RSI <= `maxRsi` (30–60): not still in free fall, not chased
//      (optional, off: RSI at least `rsiBounce` above its lowest of the last `rsiLowBars` bars)
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
//   - time stop once `maxHoldBars` bars of time have passed (measured by the clock, not the bar
//     count: quiet pairs skip bars) if the cost never came back

import { barInterval, clusterZones, ema, macd, pivotLows, rsi, sma, type Candle, type Zone } from "../indicators.ts";
import type { Strategy } from "../backtest/engine.ts";

export interface DeepDipParams {
  emaFast: number;
  emaMid: number;
  emaSlow: number;
  /** RSI must be above this: under 30 the selling usually isn't done yet. */
  minRsi: number;
  maxRsi: number;
  /** Wait for EMA 200 to exist before any signal (off: young pairs trade on EMA 9 / 21). */
  requireSlowEma: boolean;
  /** RSI must be this fraction above its recent low (0.2: low 25 needs 30); 0 = off (default).
   *  Off because across 40 pairs it lowered the median at every timeframe (15m +41.4% vs +44.2%,
   *  1h +13.1% vs +30.3%, 4h +2.9% vs +18.0%); +20 points instead of +20% was worse still. */
  rsiBounce: number;
  rsiLowBars: number;
  /** RSI swing low first: within the last `rsiSwingWithin` bars, an RSI low under the `rsiSwing`
   *  bars either side of it (confirmed by now), and RSI above that low now. 0 = off. */
  rsiSwing: number;
  rsiSwingWithin: number;
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
  /**
   * "costback": sell the cost back at the engine's `freeRideAt`, trail the rest (default).
   * "signals": sell `sellPct` of the original tokens each time `exitNeed` of `exitSignals` fire
   * on a bar closing in profit; after the first sell the stop moves to the entry price.
   */
  exitMode: "costback" | "signals";
  sellPct: number;
  exitSignals: ("volume" | "rsi" | "macd" | "climax" | "climaxTurn" | "rsiOver")[];
  exitNeed: number;
  /** "volume": bar volume at least this many times its 20-bar average. */
  exitVolMult: number;
  /** "rsi": RSI reached this within the last `exitRsiBars` bars and is now lower than the bar before. */
  exitRsiHigh: number;
  exitRsiBars: number;
  /** "macd": MACD line above zero and at least this fraction below its peak of the last `exitMacdBars` bars. */
  exitMacdDrop: number;
  exitMacdBars: number;
  /**
   * "climax": a blow-off bar -- volume >= `climaxVol` x its 20-bar average, RSI >= `climaxRsi`,
   * close >= `climaxStretch` above EMA 21. Across 41 pairs (15m) the median major top bar had
   * volume 2.8x, RSI 71, close 5.2% over EMA 21. "climaxTurn": the bar after a climax, with RSI
   * and the MACD histogram both turning down (lands at a major top ~6x as often as RSI >= 70).
   */
  climaxVol: number;
  climaxRsi: number;
  climaxStretch: number;
  /**
   * Sell into strength instead of after the turn: with `limitStretch` > 0, a limit sell for
   * `sellPct` rests each bar at EMA 21 x (1 + limitStretch) (and at least `limitMinGain` over the
   * entry), filled during the bar if the high reaches it. Optional `limitRsi`: only while the
   * previous bar's RSI is at least this.
   */
  limitStretch: number;
  limitMinGain: number;
  limitRsi: number;
  /** "rsiOver": RSI closed at or above this. `rsiLimit` > 0: also a resting limit sell at the
   *  price that would lift RSI(14) to `rsiLimit` during the next bar. */
  exitRsiOver: number;
  /** "rsiOver" with `rsiOverRearm` > 0: one sell per run above `exitRsiOver`; RSI has to close
   *  below `rsiOverRearm` before the next one. 0 sells on every bar over the level. */
  rsiOverRearm: number;
  /** Signal sells after the first need the close at least this far above the last sell price
   *  (0.2 = +20%), so a run that keeps rising is not sold off bar after bar. */
  sellStep: number;
  /** Signal sells only start once the close is this far above the entry (0.4 = +40%). */
  sellMinGain: number;
  /**
   * Higher-high sells (10% each): "close" = the close is the highest since the entry; "swing" =
   * a swing high (highest high `hhPivot` bars either side) above the previous swing high since
   * the entry, sold once it is confirmed. With `exitSignals` set, both must fire on the same bar.
   */
  hhExit: "off" | "close" | "swing";
  hhPivot: number;
  rsiLimit: number;
  trailPct: number;
  maxHoldBars: number;
}

export const DEEP_DIP_DEFAULTS: DeepDipParams = {
  emaFast: 9,
  emaMid: 21,
  emaSlow: 200,
  minRsi: 30,
  maxRsi: 60,
  requireSlowEma: false,
  rsiBounce: 0,
  rsiLowBars: 96,
  rsiSwing: 0,
  rsiSwingWithin: 6,
  useSupport: true,
  pivotBars: 5,
  zoneTol: 0.04,
  minTouches: 2,
  srLookback: 2880,
  reentry: "off",
  reentryBars: 2880,
  divergenceRsi: 3,
  stopPct: 0.2,
  exitMode: "costback",
  sellPct: 0.1,
  exitSignals: ["volume", "rsi", "macd"],
  exitNeed: 3,
  exitVolMult: 2,
  exitRsiHigh: 70,
  exitRsiBars: 5,
  exitMacdDrop: 1 / 3,
  exitMacdBars: 20,
  climaxVol: 2.5,
  climaxRsi: 70,
  climaxStretch: 0.04,
  limitStretch: 0,
  limitMinGain: 0.3,
  limitRsi: 0,
  exitRsiOver: 80,
  rsiOverRearm: 0,
  sellStep: 0,
  sellMinGain: 0,
  hhExit: "off",
  hhPivot: 2,
  rsiLimit: 0,
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
      const holdMs = p.maxHoldBars * barInterval(c);
      const volAvg = sma(c.map((x) => x.volumeUsd), 20);
      // Wilder averages behind RSI(14), to solve for the price that would lift RSI to a level.
      const avgUp: number[] = [], avgDown: number[] = [];
      for (let i = 0, g = 0, l = 0; i < close.length; i++) {
        const d = i ? close[i]! - close[i - 1]! : 0;
        if (i <= 14) { g += Math.max(d, 0) / 14; l += Math.max(-d, 0) / 14; }
        else { g = (g * 13 + Math.max(d, 0)) / 14; l = (l * 13 + Math.max(-d, 0)) / 14; }
        avgUp.push(g); avgDown.push(l);
      }
      /** Price at which bar i + 1 would close with RSI = level (rising from close i). */
      const rsiPrice = (i: number, level: number) => {
        const rs = level / (100 - level);
        const d = rs * avgDown[i]! * 13 - avgUp[i]! * 13;
        return close[i]! + Math.max(d, 0);
      };
      const climax = (i: number) =>
        c[i]!.volumeUsd >= p.climaxVol * volAvg[i]! && r[i]! >= p.climaxRsi && close[i]! >= e2[i]! * (1 + p.climaxStretch);
      /** Exit signals firing on the close of bar i (for "signals" mode). */
      const exitFired = (i: number) => {
        let n = 0;
        for (const sig of p.exitSignals) {
          if (sig === "volume" && c[i]!.volumeUsd >= p.exitVolMult * volAvg[i]!) n++;
          if (sig === "rsi") {
            let hi = -Infinity;
            for (let k = Math.max(0, i - p.exitRsiBars); k <= i; k++) hi = Math.max(hi, r[k]!);
            if (hi >= p.exitRsiHigh && r[i]! < r[i - 1]!) n++;
          }
          if (sig === "climax" && climax(i)) n++;
          if (sig === "rsiOver" && r[i]! >= p.exitRsiOver) {
            let armed = p.rsiOverRearm <= 0;
            for (let k = i - 1; !armed && k >= 0; k--) {
              if (r[k]! >= p.exitRsiOver) break;
              if (r[k]! < p.rsiOverRearm) armed = true;
            }
            if (armed) n++;
          }
          if (sig === "climaxTurn" && climax(i - 1) && r[i]! < r[i - 1]! && m.hist[i]! < m.hist[i - 1]!) n++;
          if (sig === "macd") {
            let peak = -Infinity;
            for (let k = Math.max(0, i - p.exitMacdBars); k <= i; k++) peak = Math.max(peak, m.line[k]!);
            if (peak > 0 && m.line[i]! > 0 && m.line[i]! <= peak * (1 - p.exitMacdDrop)) n++;
          }
        }
        return n >= p.exitNeed;
      };
      const isSwingHigh = (j: number) => {
        if (j - p.hhPivot < 0 || j + p.hhPivot >= c.length) return false;
        for (let k = j - p.hhPivot; k <= j + p.hhPivot; k++) if (k !== j && c[k]!.high >= c[j]!.high) return false;
        return true;
      };
      /** A higher high on the close of bar i, counting only bars since the entry. */
      const higherHigh = (i: number, from: number) => {
        if (p.hhExit === "close") {
          for (let k = from; k < i; k++) if (close[k]! >= close[i]!) return false;
          return i > from;
        }
        const j = i - p.hhPivot;
        if (j < from || !isSwingHigh(j)) return false;
        for (let k = j - 1; k >= from; k--) if (k + p.hhPivot <= i - 1 && isSwingHigh(k)) return c[j]!.high > c[k]!.high;
        return true;
      };
      const warmup = p.requireSlowEma ? p.emaSlow + 1 : Math.max(p.emaMid, 26 + 9) + 1;
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

      /** The most recent confirmed RSI swing low within `rsiSwingWithin` bars of i, or null. */
      const rsiSwingLow = (i: number): number | null => {
        const k = p.rsiSwing;
        for (let j = i - k; j >= Math.max(k, i - p.rsiSwingWithin); j--) {
          let ok = Number.isFinite(r[j]!);
          for (let q = j - k; ok && q <= j + k; q++) if (q !== j && !(r[q]! > r[j]!)) ok = false;
          if (ok) return r[j]!;
        }
        return null;
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
          ...(p.rsiSwing > 0
            ? (() => {
                const low = rsiSwingLow(i);
                return [
                  {
                    label: "RSI made a swing low",
                    ok: low !== null && rv > low,
                    detail: low === null ? "no RSI swing low yet" : `${low.toFixed(0)} → ${rv.toFixed(0)}`,
                  },
                ];
              })()
            : []),
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
          if (p.exitMode === "signals") return pos.partialsSold > 0 ? Math.max(pos.stop, pos.entryPrice) : pos.stop;
          if (!pos.costRecovered) return pos.stop;
          return Math.max(pos.stop, pos.entryPrice, pos.highestClose * (1 - p.trailPct));
        },
        shouldTimeExit(i, pos) {
          if (p.exitMode === "signals" && pos.partialsSold > 0) return false;
          return !pos.costRecovered && c[i]!.time - c[pos.entryIndex]!.time >= holdMs;
        },
        limitSell(i, pos) {
          if (p.exitMode !== "signals") return null;
          if (p.rsiLimit > 0) return { price: Math.max(rsiPrice(i, p.rsiLimit), pos.entryPrice * (1 + p.limitMinGain)), fraction: p.sellPct };
          if (p.limitStretch <= 0 || r[i]! < p.limitRsi) return null;
          return { price: Math.max(e2[i]! * (1 + p.limitStretch), pos.entryPrice * (1 + p.limitMinGain)), fraction: p.sellPct };
        },
        partialExit(i, pos) {
          if (p.exitMode !== "signals" || c[i]!.close <= pos.entryPrice) return 0;
          if (pos.partialsSold === 0 && c[i]!.close < pos.entryPrice * (1 + p.sellMinGain)) return 0;
          if (p.sellStep > 0 && pos.lastSellPrice > 0 && c[i]!.close < pos.lastSellPrice * (1 + p.sellStep)) return 0;
          if (p.hhExit !== "off" && !higherHigh(i, pos.entryIndex)) return 0;
          return p.hhExit !== "off" && p.exitSignals.length === 0 ? p.sellPct : exitFired(i) ? p.sellPct : 0;
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
