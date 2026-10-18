// Usage: npm run backtest -- [resolution] [--pair robinhood|base|solana] [--refresh] [--sweep]
import { pairFromArgs, positionalArg } from "../pairs.ts";
import type { Resolution } from "../dexscreener/bars.ts";
import { loadBarsHistory } from "../dexscreener/history.ts";
import { toCandles } from "../indicators.ts";
import { DEFAULT_CONFIG, runBacktest, type Stats } from "../backtest/engine.ts";
import { DEFAULT_PARAMS, volumeBreakout, type VolumeBreakoutParams } from "../strategy/volumeBreakout.ts";

const args = process.argv.slice(2);
const resolution = Number(positionalArg(args) ?? 15) as Resolution;

const { pair } = pairFromArgs(args);

const bars = await loadBarsHistory(
  { ...pair, resolution },
  `data/${pair.chain}-${pair.pairId.slice(0, 10)}-${resolution}.json`,
  args.includes("--refresh"),
);
const candles = toCandles(bars);
const iso = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

console.log(`\n${candles.length} x ${resolution}m candles  ${iso(candles[0]!.time)} -> ${iso(candles.at(-1)!.time)} UTC`);
console.log(
  `capital ${DEFAULT_CONFIG.initialCapital}, fee ${DEFAULT_CONFIG.feeRate * 100}%/side, slippage ${DEFAULT_CONFIG.slippage * 100}%/side\n`,
);

const fmt = (s: Stats) => ({
  trades: s.trades,
  "win %": s.winRate.toFixed(1),
  "return %": s.totalReturnPct.toFixed(1),
  "buy&hold %": s.buyHoldReturnPct.toFixed(1),
  "maxDD %": s.maxDrawdownPct.toFixed(1),
  PF: s.profitFactor.toFixed(2),
  "avg trade %": s.avgTradePct.toFixed(2),
  "avg win %": s.avgWinPct.toFixed(2),
  "avg loss %": s.avgLossPct.toFixed(2),
  "avg bars": s.avgBarsHeld.toFixed(1),
  "exposure %": s.exposurePct.toFixed(1),
});

const result = runBacktest(candles, volumeBreakout());
console.log(`Strategy: Volume Breakout Momentum (default params)`);
console.table([fmt(result.stats)]);
console.table(
  result.trades.map((t) => ({
    entry: iso(t.entryTime),
    exit: iso(t.exitTime),
    bars: t.bars,
    "return %": t.returnPct.toFixed(2),
    reason: t.reason,
  })),
);

if (args.includes("--sweep")) {
  // Robustness check: a strategy that only works at one exact setting is overfit.
  const rows: Record<string, string | number>[] = [];
  for (const volumeMultiplier of [2, 2.5, 3]) {
    for (const breakoutLookback of [10, 20, 40]) {
      for (const trailAtr of [2, 3, 4]) {
        const params: Partial<VolumeBreakoutParams> = { volumeMultiplier, breakoutLookback, trailAtr };
        const s = runBacktest(candles, volumeBreakout(params)).stats;
        rows.push({ volX: volumeMultiplier, lookback: breakoutLookback, trailAtr, ...fmt(s) });
      }
    }
  }
  rows.sort((a, b) => Number(b["return %"]) - Number(a["return %"]));
  const profitable = rows.filter((r) => Number(r["return %"]) > 0).length;
  console.log(`\nParameter sweep: ${profitable}/${rows.length} settings profitable (default: ${JSON.stringify({
    volX: DEFAULT_PARAMS.volumeMultiplier,
    lookback: DEFAULT_PARAMS.breakoutLookback,
    trailAtr: DEFAULT_PARAMS.trailAtr,
  })})`);
  console.table(rows.map(({ volX, lookback, trailAtr, trades, "win %": w, "return %": r, "maxDD %": dd, PF }) => ({
    volX, lookback, trailAtr, trades, "win %": w, "return %": r, "maxDD %": dd, PF,
  })));
}
