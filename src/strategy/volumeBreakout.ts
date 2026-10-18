// Volume Breakout Momentum
//
// Entry (evaluated on bar close, filled at next bar open):
//   1. close breaks the highest high of the previous `breakoutLookback` bars
//   2. volumeUsd >= `volumeMultiplier` x SMA(volumeUsd, `volumeLookback`)
//   3. close > EMA(`trendEma`)                       -- only trade with the trend
//   4. close <= EMA(`fastEma`) x (1 + `maxExtension`) -- skip blow-off candles
//   5. volumeUsd >= `minVolumeUsd`                   -- skip illiquid bars
// Exit:
//   - initial stop: entry - `stopAtr` x ATR
//   - trailing stop: highest close since entry - `trailAtr` x ATR (only moves up)
//   - time stop after `maxHoldBars`

import { atr, ema, priorHighest, sma, type Candle } from "../indicators.ts";
import type { Strategy } from "../backtest/engine.ts";

export interface VolumeBreakoutParams {
  breakoutLookback: number;
  volumeLookback: number;
  volumeMultiplier: number;
  trendEma: number;
  fastEma: number;
  maxExtension: number;
  minVolumeUsd: number;
  atrPeriod: number;
  stopAtr: number;
  trailAtr: number;
  maxHoldBars: number;
}

export const DEFAULT_PARAMS: VolumeBreakoutParams = {
  breakoutLookback: 20,
  volumeLookback: 20,
  volumeMultiplier: 2.5,
  trendEma: 50,
  fastEma: 20,
  maxExtension: 0.15,
  minVolumeUsd: 1000,
  atrPeriod: 14,
  stopAtr: 2,
  trailAtr: 3,
  maxHoldBars: 96,
};

export function volumeBreakout(params: Partial<VolumeBreakoutParams> = {}): Strategy {
  const p = { ...DEFAULT_PARAMS, ...params };
  return {
    name: "Volume Breakout Momentum",
    prepare(c: Candle[]) {
      const closes = c.map((x) => x.close);
      const highs = priorHighest(c, p.breakoutLookback);
      const volAvg = sma(c.map((x) => x.volumeUsd), p.volumeLookback);
      const trend = ema(closes, p.trendEma);
      const fast = ema(closes, p.fastEma);
      const atrs = atr(c, p.atrPeriod);

      return {
        indicators: [
          { name: `EMA${p.fastEma}`, values: fast, color: "#f5a623", pane: "price" },
          { name: `EMA${p.trendEma}`, values: trend, color: "#b388ff", pane: "price" },
          { name: `Breakout high ${p.breakoutLookback}`, values: highs, color: "#90a4ae", pane: "price", dashed: true },
          {
            name: `Volume x${p.volumeMultiplier} avg`,
            values: volAvg.map((v) => v * p.volumeMultiplier),
            color: "#ffd54f",
            pane: "volume",
          },
        ],
        shouldEnter(i) {
          const bar = c[i]!;
          return (
            bar.close > highs[i]! &&
            bar.volumeUsd >= p.volumeMultiplier * volAvg[i]! &&
            bar.volumeUsd >= p.minVolumeUsd &&
            bar.close > trend[i]! &&
            bar.close <= fast[i]! * (1 + p.maxExtension)
          );
        },
        initialStop(i, entryPrice) {
          return entryPrice - p.stopAtr * atrs[i]!;
        },
        updateStop(i, pos) {
          return Math.max(pos.stop, pos.highestClose - p.trailAtr * atrs[i]!);
        },
        shouldTimeExit(i, pos) {
          return i - pos.entryIndex >= p.maxHoldBars;
        },
        plan(i) {
          if (i < p.trendEma) return null;
          // The next bar breaks out if it closes above the high of the last `breakoutLookback` bars.
          let trigger = -Infinity;
          for (let j = Math.max(0, i - p.breakoutLookback + 1); j <= i; j++) trigger = Math.max(trigger, c[j]!.high);
          const volAvg = sma(c.map((x) => x.volumeUsd), p.volumeLookback)[i]!;
          return {
            kind: "trigger" as const,
            low: trigger,
            high: trigger,
            stop: trigger - p.stopAtr * atrs[i]!,
            waitFor: `close above with volume ≥ $${Math.max(p.minVolumeUsd, volAvg * p.volumeMultiplier).toFixed(0)}`,
          };
        },
        conditions(i) {
          const bar = c[i]!;
          // 7486000 -> "7.486M", 0.00001234 -> "0.00001234"; toPrecision alone gives "7.486e+6".
          const px = (v: number) => {
            const abs = Math.abs(v);
            for (const [div, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
              if (abs >= div) return `${(v / div).toPrecision(4)}${suffix}`;
            }
            return v.toPrecision(4);
          };
          return [
            { label: `Close > ${p.breakoutLookback}-bar high`, ok: bar.close > highs[i]!, detail: `${px(bar.close)} vs ${px(highs[i]!)}` },
            {
              label: `Volume >= ${p.volumeMultiplier}x avg`,
              ok: bar.volumeUsd >= p.volumeMultiplier * volAvg[i]!,
              detail: `${(bar.volumeUsd / volAvg[i]!).toFixed(1)}x`,
            },
            { label: `Volume >= $${p.minVolumeUsd}`, ok: bar.volumeUsd >= p.minVolumeUsd, detail: `$${bar.volumeUsd.toFixed(0)}` },
            { label: `Close > EMA${p.trendEma}`, ok: bar.close > trend[i]!, detail: `${px(bar.close)} vs ${px(trend[i]!)}` },
            {
              label: `Within ${p.maxExtension * 100}% of EMA${p.fastEma}`,
              ok: bar.close <= fast[i]! * (1 + p.maxExtension),
              detail: `${((bar.close / fast[i]! - 1) * 100).toFixed(1)}%`,
            },
          ];
        },
      };
    },
  };
}
