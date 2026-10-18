// Usage: npm run chart -- [resolution] [--pair robinhood|base|solana] [--free <pct>] [--refresh] [--no-open]
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pairFromArgs, positionalArg } from "../pairs.ts";
import type { Resolution } from "../dexscreener/bars.ts";
import { loadBarsHistory } from "../dexscreener/history.ts";
import { toCandles } from "../indicators.ts";
import { DEFAULT_CONFIG, runBacktest } from "../backtest/engine.ts";
import { volumeBreakout } from "../strategy/volumeBreakout.ts";
import { renderReport } from "../report/html.ts";

const args = process.argv.slice(2);
const resolution = Number(positionalArg(args) ?? 5) as Resolution;

const { pair } = pairFromArgs(args);
const tag = `${pair.chain}-${pair.pairId.slice(0, 10)}-${resolution}`;

const bars = await loadBarsHistory({ ...pair, resolution }, `data/${tag}.json`, args.includes("--refresh"));
const candles = toCandles(bars);
const strategy = volumeBreakout();
const freeIdx = args.indexOf("--free");
const freeRideAt = freeIdx >= 0 ? Number(args[freeIdx + 1]) / 100 : undefined;
const result = runBacktest(candles, strategy, { ...DEFAULT_CONFIG, freeRideAt });

const file = resolve(`data/report-${tag}${freeRideAt === undefined ? "" : `-free${freeRideAt * 100}`}.html`);
await mkdir("data", { recursive: true });
await writeFile(file, renderReport({ title: `${strategy.name} · ${pair.chain} ${resolution}m`, candles, result }));

const s = result.stats;
console.log(`${result.trades.length} trades, return ${s.totalReturnPct.toFixed(1)}%, max DD ${s.maxDrawdownPct.toFixed(1)}%`);
console.log(`Report: ${file}`);
if (!args.includes("--no-open") && process.platform === "darwin") execFile("open", [file]);
