// Every strategy on every pair in src/universe.txt (DEX Screener export rows:
// chain, dex, quote token, base token, pair), with the free-ride settings the extension uses.
// Usage: npm run universe -- [--refresh] [--detail] [--hold (keep free tokens to the end, no ladder)]
import { readFileSync } from "node:fs";
import type { Resolution } from "../dexscreener/bars.ts";
import { loadBarsHistory } from "../dexscreener/history.ts";
import { toCandles } from "../indicators.ts";
import { DEFAULT_CONFIG, FREE_LADDER, runBacktest, type Strategy } from "../backtest/engine.ts";
import { quietAccumulation } from "../strategy/quietAccumulation.ts";
import { deepDip } from "../strategy/emaMacdRsi.ts";

const refresh = process.argv.includes("--refresh");
const pairs = readFileSync(new URL("../universe.txt", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((l) => l.trim().split(/\s+/))
  .map(([chain, dex, quoteToken, baseToken, pairId]) => ({ chain: chain!, dex: dex!, quoteToken: quoteToken!, baseToken: baseToken!, pairId: pairId! }));

const ladder = !process.argv.includes("--hold");
const cfg = { ...DEFAULT_CONFIG, positionSize: 0.1, freeRideAt: 2, freeRideKeep: 0.1, ...(ladder ? { freeLadder: FREE_LADDER } : {}) };
const strategies = (perDay: number): Strategy[] => [
  quietAccumulation({ volFast: perDay, volSlow: perDay * 5, srLookback: perDay * 30, maxHoldBars: perDay * 30 }),
  deepDip({ srLookback: perDay * 30, maxHoldBars: perDay * 30, rsiLowBars: perDay }),
];

type Row = { coin: string; trades: number; costBacks: number; ret: number; dd: number };
const results = new Map<string, Row[]>(); // key: "<tf> <strategy>"
const skipped: string[] = [];

for (const resolution of [15, 60, 240] as Resolution[]) {
  const perDay = Math.round(1440 / resolution);
  for (const pair of pairs) {
    const coin = `${pair.chain}:${pair.baseToken.slice(0, 6)}`;
    let candles;
    try {
      const bars = await loadBarsHistory({ ...pair, resolution }, `data/${pair.chain}-${pair.pairId.slice(0, 10)}-${resolution}.json`, refresh);
      candles = toCandles(bars);
    } catch (e) {
      skipped.push(`${coin} ${resolution}m: ${(e as Error).message}`);
      continue;
    }
    for (const s of strategies(perDay)) {
      if (candles.length < 210) continue;
      const { trades, stats } = runBacktest(candles, s, cfg);
      const key = `${resolution}m ${s.name}`;
      if (!results.has(key)) results.set(key, []);
      results.get(key)!.push({
        coin,
        trades: stats.trades,
        costBacks: trades.filter((t) => t.costBackTime !== undefined).length,
        ret: stats.totalReturnPct,
        dd: stats.maxDrawdownPct,
      });
    }
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2 : NaN;
};
console.log(`\n${pairs.length} pairs · 10% per trade · cost back at 3x · keep 10% ${ladder ? "(sold at 10x/30x/100x)" : "(held)"} · fee+slippage 0.8%/side`);
console.table(
  [...results].map(([key, rows]) => ({
    setup: key,
    coins: rows.length,
    "traded on": rows.filter((r) => r.trades).length,
    "profitable": rows.filter((r) => r.ret > 0).length,
    "losing": rows.filter((r) => r.ret < 0).length,
    trades: rows.reduce((a, r) => a + r.trades, 0),
    "cost backs": rows.reduce((a, r) => a + r.costBacks, 0),
    "median %": median(rows.filter((r) => r.trades).map((r) => r.ret)).toFixed(1),
    "mean %": (rows.reduce((a, r) => a + r.ret, 0) / rows.length).toFixed(1),
    "worst %": Math.min(...rows.map((r) => r.ret)).toFixed(1),
    "median DD %": median(rows.filter((r) => r.trades).map((r) => r.dd)).toFixed(1),
  })),
);
if (process.argv.includes("--detail")) {
  for (const [key, rows] of results) {
    console.log(`\n${key}`);
    console.table(rows.map((r) => ({ ...r, ret: r.ret.toFixed(1), dd: r.dd.toFixed(1) })));
  }
}
if (skipped.length) console.log(`\nSkipped:\n  ${skipped.join("\n  ")}`);
