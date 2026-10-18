// Quiet Accumulation + free ride vs the Volume Breakout scalper.
// Usage: npm run accumulate -- [--pair robinhood|base|solana] [--size 0.1]
import { pairFromArgs } from "../pairs.ts";
import type { Resolution } from "../dexscreener/bars.ts";
import { loadBarsHistory } from "../dexscreener/history.ts";
import { toCandles, type Candle } from "../indicators.ts";
import { DEFAULT_CONFIG, runBacktest, type BacktestConfig } from "../backtest/engine.ts";
import { volumeBreakout } from "../strategy/volumeBreakout.ts";
import { quietAccumulation, type QuietAccumulationParams } from "../strategy/quietAccumulation.ts";

const args = process.argv.slice(2);
const { name, pair } = pairFromArgs(args);
const sizeIdx = args.indexOf("--size");
const size = sizeIdx >= 0 ? Number(args[sizeIdx + 1]) : 0.1;

// Bar counts scale with the timeframe so "48 bars" means about the same time span.
const perDay: Record<number, number> = { 15: 96, 60: 24, 240: 6 };

/** Highest price reached after each free-ride exit, as a multiple of the entry. */
function freeBagPeaks(candles: Candle[], trades: ReturnType<typeof runBacktest>["trades"]): number[] {
  return trades
    .filter((t) => t.freeQty)
    .map((t) => {
      let peak = 0;
      for (const c of candles) if (c.time >= t.exitTime) peak = Math.max(peak, c.high);
      return peak / t.entryPrice;
    });
}

const rows: Record<string, string | number>[] = [];
for (const resolution of [15, 60, 240] as Resolution[]) {
  const bars = await loadBarsHistory({ ...pair, resolution }, `data/${pair.chain}-${pair.pairId.slice(0, 10)}-${resolution}.json`);
  const candles = toCandles(bars);
  const d = perDay[resolution]!;
  const days = Math.round((candles.at(-1)!.time - candles[0]!.time) / 86_400_000);

  const runs: { style: string; strategy: ReturnType<typeof volumeBreakout>; cfg: BacktestConfig }[] = [
    { style: "Breakout scalp (all-in)", strategy: volumeBreakout(), cfg: DEFAULT_CONFIG },
  ];
  for (const minDrawdown of [0.7, 0.85]) {
    for (const [freeRideAt, keep] of [[1, undefined], [1, 0.1], [2, 0.1]] as const) {
      const params: Partial<QuietAccumulationParams> = {
        minDrawdown,
        volFast: d,
        volSlow: d * 10,
        baseBars: d * 2,
        maxHoldBars: d * 30,
      };
      runs.push({
        style: `Quiet -${minDrawdown * 100}% · cost @ ${freeRideAt + 1}x · keep ${keep === undefined ? "all" : `${keep * 100}%`}`,
        strategy: quietAccumulation(params),
        cfg: { ...DEFAULT_CONFIG, positionSize: size, freeRideAt, freeRideKeep: keep },
      });
    }
  }

  for (const r of runs) {
    const { trades, stats: s } = runBacktest(candles, r.strategy, r.cfg);
    const peaks = freeBagPeaks(candles, trades);
    rows.push({
      tf: `${resolution}m`,
      days,
      style: r.style,
      trades: s.trades,
      "free hits": peaks.length,
      "best bag peak": peaks.length ? `${Math.max(...peaks).toFixed(1)}x` : "-",
      cash: s.realizedCash.toFixed(0),
      "free value": s.freeValue.toFixed(0),
      "total %": s.totalReturnPct.toFixed(1),
      "maxDD %": s.maxDrawdownPct.toFixed(1),
    });
  }
}

console.log(`\n${name}: capital ${DEFAULT_CONFIG.initialCapital}, quiet entries use ${size * 100}% of cash per trade, fee+slippage 0.8%/side`);
console.table(rows);
