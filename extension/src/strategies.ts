// Strategies the extension can run, with the backtest settings each one is meant to use.
import { DEFAULT_CONFIG, FREE_LADDER, type BacktestConfig, type Strategy } from "../../src/backtest/engine.ts";
import { DEFAULT_PARAMS, volumeBreakout } from "../../src/strategy/volumeBreakout.ts";
import { quietAccumulation } from "../../src/strategy/quietAccumulation.ts";
import type { StudySpec } from "./messages.ts";
import { DEEP_DIP_DEFAULTS, deepDip } from "../../src/strategy/emaMacdRsi.ts";

export type StrategyId = "breakout" | "quiet" | "dip" | "launch";

export interface StrategySetup {
  id: StrategyId;
  name: string;
  strategy: Strategy;
  config: BacktestConfig;
  /** Closed bars needed before the first signal is possible. */
  minBars: number;
  /** Short condition labels for the on-chart table, in `conditions()` order. */
  shortLabels: string[];
  /** One line describing sizing and exits, shown with the backtest numbers. */
  note: string;
  /** Indicators the strategy reads, added to the chart for the user to see. */
  studies: StudySpec[];
}

const emaStudy = (length: number, color: string): StudySpec => ({ name: "Moving Average Exponential", inputs: { length }, color });

export const STRATEGY_NAMES: Record<StrategyId, string> = {
  breakout: "Volume Breakout",
  quiet: "Quiet Accumulation",
  dip: "Deep Dip",
  launch: "New Launch",
};

export function setupStrategy(id: StrategyId, resolutionMinutes: number): StrategySetup {
  if (id === "dip" || id === "launch") {
    const perDay = Math.max(1, Math.round(1440 / resolutionMinutes));
    const launch = id === "launch";
    return {
      id,
      name: STRATEGY_NAMES[id],
      strategy: deepDip({ srLookback: perDay * 30, maxHoldBars: perDay * 30, rsiLowBars: perDay }),
      // Same sizing as Quiet; across 40 pairs this did best on 15m (30 of 40 profitable). The
      // ladder cut the worst drawdown from 99% to 54% there.
      // New Launch: the same rules at half size for a pair's first week, where rugs are likelier.
      // First 7 days of 34 pairs on 5m: 23 profitable, median +2.5% for the week, worst -17%.
      config: { ...DEFAULT_CONFIG, positionSize: launch ? 0.05 : 0.1, freeRideAt: 2, freeRideKeep: 0.1, freeLadder: FREE_LADDER },
      // EMA 200 is skipped until it exists, so MACD (26 + 9 bars) sets the minimum.
      minBars: 37,
      shortLabels: ["Under EMAs", "MACD turn", "RSI", "Support"],
      note: launch
        ? `5% per trade · cost back at 3x · keep 10% free · for a pair's first week${resolutionMinutes === 5 ? "" : " · best on 5m"}`
        : `10% per trade · cost back at 3x · keep 10% free, sold at 10x/30x/100x${resolutionMinutes === 15 ? "" : " · best on 15m"}`,
      studies: [
        emaStudy(DEEP_DIP_DEFAULTS.emaFast, "#fbbf24"),
        emaStudy(DEEP_DIP_DEFAULTS.emaMid, "#2196f3"),
        emaStudy(DEEP_DIP_DEFAULTS.emaSlow, "#ffffff"),
        // New panes stack downwards in creation order: RSI, then MACD under it.
        { name: "Relative Strength Index", inputs: { length: 14 } },
        { name: "MACD" },
      ],
    };
  }
  if (id === "quiet") {
    // Quiet Accumulation thinks in days; convert to bars for this timeframe.
    const perDay = Math.max(1, Math.round(1440 / resolutionMinutes));
    const volSlow = perDay * 5;
    return {
      id,
      name: STRATEGY_NAMES.quiet,
      strategy: quietAccumulation({ volFast: perDay, volSlow, srLookback: perDay * 30, maxHoldBars: perDay * 30 }),
      // Best setting in the backtests: 10% per trade, sell the cost back at 3x, keep 10% free.
      config: { ...DEFAULT_CONFIG, positionSize: 0.1, freeRideAt: 2, freeRideKeep: 0.1, freeLadder: FREE_LADDER },
      minBars: volSlow + 2,
      shortLabels: ["Below ATH", "Support", "Reversal", "Selling faded"],
      note: "10% per trade · cost back at 3x · keep 10% free, sold at 10x/30x/100x",
      // Support / resistance are drawn as levels; volume shows the "selling faded" rule.
      studies: [{ name: "Volume" }],
    };
  }
  return {
    id,
    name: STRATEGY_NAMES.breakout,
    strategy: volumeBreakout(),
    config: DEFAULT_CONFIG,
    minBars: DEFAULT_PARAMS.trendEma + 2,
    shortLabels: ["Breakout", "Volume ×", "Min volume", "Trend EMA", "Not extended"],
    note: "full position · ATR trailing stop",
    studies: [
      emaStudy(DEFAULT_PARAMS.fastEma, "#fbbf24"),
      emaStudy(DEFAULT_PARAMS.trendEma, "#2196f3"),
      { name: "Volume" },
    ],
  };
}
