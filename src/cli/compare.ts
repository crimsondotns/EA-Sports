// Scalping vs Spot, both with "free ride" (take the cost back, keep the rest).
// Usage: npm run compare -- [--pair robinhood|base|solana]
import { pairFromArgs } from "../pairs.ts";
import type { Resolution } from "../dexscreener/bars.ts";
import { loadBarsHistory } from "../dexscreener/history.ts";
import { toCandles } from "../indicators.ts";
import { DEFAULT_CONFIG, runBacktest } from "../backtest/engine.ts";
import { volumeBreakout, type VolumeBreakoutParams } from "../strategy/volumeBreakout.ts";

const { name, pair } = pairFromArgs(process.argv.slice(2));

// "Hold" = no trailing stop and no time stop: wait for the free-ride target or the initial stop.
const hold: Partial<VolumeBreakoutParams> = { trailAtr: Infinity, maxHoldBars: Infinity, stopAtr: 3 };

const styles: { style: string; resolution: Resolution; freeRideAt?: number; params?: Partial<VolumeBreakoutParams> }[] = [
  { style: "Scalping (no free ride)", resolution: 5 },
  { style: "Scalping, free @ +20%", resolution: 5, freeRideAt: 0.2 },
  { style: "Scalping, free @ +50%", resolution: 5, freeRideAt: 0.5 },
  { style: "Spot (no free ride)", resolution: 60 },
  { style: "Spot, free @ +50%", resolution: 60, freeRideAt: 0.5 },
  { style: "Spot, free @ +100% (2x)", resolution: 60, freeRideAt: 1 },
  { style: "Spot 15m, free @ +100% (2x)", resolution: 15, freeRideAt: 1 },
  { style: "Scalping hold, free @ +20%", resolution: 5, freeRideAt: 0.2, params: hold },
  { style: "Scalping hold, free @ +50%", resolution: 5, freeRideAt: 0.5, params: hold },
  { style: "Spot hold 15m, free @ +100%", resolution: 15, freeRideAt: 1, params: hold },
  { style: "Spot hold 1h, free @ +100%", resolution: 60, freeRideAt: 1, params: hold },
  { style: "Spot hold 1h, free @ +200%", resolution: 60, freeRideAt: 2, params: hold },
];

const rows = [];
for (const st of styles) {
  const bars = await loadBarsHistory(
    { ...pair, resolution: st.resolution },
    `data/${pair.chain}-${pair.pairId.slice(0, 10)}-${st.resolution}.json`,
  );
  const candles = toCandles(bars);
  const { trades, stats: s } = runBacktest(candles, volumeBreakout(st.params), { ...DEFAULT_CONFIG, freeRideAt: st.freeRideAt });
  rows.push({
    style: st.style,
    tf: `${st.resolution}m`,
    days: Math.round((candles.at(-1)!.time - candles[0]!.time) / 86_400_000),
    trades: s.trades,
    "free hits": trades.filter((t) => t.reason === "free").length,
    "cash": s.realizedCash.toFixed(0),
    "free value": s.freeValue.toFixed(0),
    "total %": s.totalReturnPct.toFixed(1),
    "maxDD %": s.maxDrawdownPct.toFixed(1),
  });
}
console.log(`\n${name}: capital ${DEFAULT_CONFIG.initialCapital}, fee ${DEFAULT_CONFIG.feeRate * 100}% + slippage ${DEFAULT_CONFIG.slippage * 100}% per side`);
console.table(rows);
