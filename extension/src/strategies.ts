// Strategies the extension can run, with the backtest settings each one is meant to use.
import { DEFAULT_CONFIG, type BacktestConfig, type Strategy } from "../../src/backtest/engine.ts";
import { DEFAULT_PARAMS, volumeBreakout } from "../../src/strategy/volumeBreakout.ts";
import { quietAccumulation } from "../../src/strategy/quietAccumulation.ts";
import { DEEP_DIP_DEFAULTS, deepDip } from "../../src/strategy/emaMacdRsi.ts";

export type StrategyId = "breakout" | "quiet" | "dip";

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
}

export const STRATEGY_NAMES: Record<StrategyId, string> = {
  breakout: "Volume Breakout",
  quiet: "Quiet Accumulation",
  dip: "Deep Dip",
};

export function setupStrategy(id: StrategyId, resolutionMinutes: number): StrategySetup {
  if (id === "dip") {
    const perDay = Math.max(1, Math.round(1440 / resolutionMinutes));
    return {
      id,
      name: STRATEGY_NAMES.dip,
      strategy: deepDip({ maxHoldBars: perDay * 30 }),
      // Same sizing as Quiet; across 40 pairs this did best on 15m (30 of 40 profitable).
      config: { ...DEFAULT_CONFIG, positionSize: 0.1, freeRideAt: 2, freeRideKeep: 0.1 },
      minBars: DEEP_DIP_DEFAULTS.emaSlow + 2,
      shortLabels: ["Under EMAs", "MACD turn", "RSI"],
      note: `10% per trade · cost back at 3x · keep 10% free${resolutionMinutes === 15 ? "" : " · best on 15m"}`,
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
      config: { ...DEFAULT_CONFIG, positionSize: 0.1, freeRideAt: 2, freeRideKeep: 0.1 },
      minBars: volSlow + 2,
      shortLabels: ["Below ATH", "Support", "Reversal", "Selling faded"],
      note: "10% per trade · cost back at 3x · keep 10% free",
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
  };
}
