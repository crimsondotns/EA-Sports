// Strategies the extension can run, with the backtest settings each one is meant to use.
import { DEFAULT_CONFIG, FREE_LADDER, type BacktestConfig, type Strategy } from "../../src/backtest/engine.ts";
import { DEFAULT_PARAMS, volumeBreakout } from "../../src/strategy/volumeBreakout.ts";
import { quietAccumulation } from "../../src/strategy/quietAccumulation.ts";
import type { StudySpec } from "./messages.ts";
import { DEEP_DIP_DEFAULTS, deepDip } from "../../src/strategy/emaMacdRsi.ts";

export type StrategyId = "breakout" | "quiet" | "dip" | "launch" | "range";

export interface StrategySetup {
  id: StrategyId;
  name: string;
  strategy: Strategy;
  config: BacktestConfig;
  /** Closed bars needed before the first signal is possible. */
  minBars: number;
  /** Short condition labels for the on-chart table, in `conditions()` order. */
  shortLabels: string[];
  /** Label for partial-sell markers and the resting sell line (default "SELL 10%"). */
  sellLabel?: string;
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
  range: "Range Swing",
};

export function setupStrategy(id: StrategyId, resolutionMinutes: number): StrategySetup {
  if (id === "range") {
    // Trade the range: Deep Dip's entry, but always within 3% of the 7-day low, then sell the
    // whole position at a limit 3% under the 7-day high (at least +5%). Tested and losing:
    // 41 pairs 15m median -0.5% (18/41 profitable, 65% of trades win), 1h -1.7%. Shown so the
    // trades can be inspected on the chart; Deep Dip stays the default.
    const perDay = Math.max(1, Math.round(1440 / resolutionMinutes));
    const dip = setupStrategy("dip", resolutionMinutes);
    return {
      ...dip,
      id,
      name: STRATEGY_NAMES.range,
      strategy: deepDip({
        srLookback: perDay * 30,
        maxHoldBars: perDay * 30,
        rsiLowBars: perDay,
        exitMode: "signals",
        exitSignals: [],
        breakevenAt: null,
        rsiSwing: 2,
        rsiSwingWithin: 6,
        rangeLowBars: perDay * 7,
        rangeLowTol: 0.03,
        rangeSellTol: 0.03,
        rangeSellMinGain: 0.05,
      }),
      config: { ...DEFAULT_CONFIG, positionSize: 0.1, freeRideKeep: 0 },
      shortLabels: ["Under EMAs", "MACD turn", "RSI", "Range low", "RSI swing low", "Support"],
      sellLabel: "SELL ALL",
      note: "10% per trade · buy within 3% of the 7-day low · sell all at the 7-day high −3% · stop −20% · backtest: loses on most pairs",
    };
  }
  if (id === "dip" || id === "launch") {
    const perDay = Math.max(1, Math.round(1440 / resolutionMinutes));
    const launch = id === "launch";
    // 15m: sell 10% at each confirmed swing higher high (2 bars either side; $880 x 15 coins:
    // +$3,355, 11/15). 1h: sell 10% on each new highest close since the entry (+$3,571, worst -$94;
    // swing highs made only +$845 there).
    const hourly = resolutionMinutes === 60;
    const signalExit = !launch && (resolutionMinutes === 15 || resolutionMinutes === 60);
    return {
      id,
      name: STRATEGY_NAMES[id],
      // Deep Dip on 15m and 1h sells 10% at each swing higher high (15m) or new highest close (1h); 4h and up keep
      // the cost-back exit. New Launch keeps cost back too (untested with these exits).
      strategy: deepDip({
        srLookback: perDay * 30,
        maxHoldBars: perDay * 30,
        rsiLowBars: perDay,
        // The stop stays at -20% after the first sell (moving it to the entry: 15m median +83% vs
        // +138%, 1h +23% vs +47% across 41 pairs). 1h also counts a support broken by up to 10%.
        ...(signalExit ? { exitMode: "signals" as const, exitSignals: [], hhExit: hourly ? ("close" as const) : ("swing" as const), hhPivot: 2, breakevenAt: null } : {}),
        ...(hourly && !launch ? { supportBreak: 0.1 } : {}),
        // Wait for an RSI swing low (under the 2 bars either side, within the last 6 bars) and
        // RSI back above it, instead of buying while RSI is still falling. 41 pairs: 15m median
        // +121% vs +138%, 1h +59% and 32/40 profitable vs +62% and 30/40.
        ...(signalExit ? { rsiSwing: 2, rsiSwingWithin: 6 } : {}),
        // Big picture: unless EMA 200 is rising (uptrend), only buy within a few % of the lowest
        // low of the last 7 days. 41 pairs: 15m (+5%, EMA 200 up over 3 days) median +96.6% vs
        // +121%, worst $880 coin -$122 vs -$145; 1h (+3%, 1 day) +52.6% vs +59.1%, worst -$11 vs -$23.
        ...(signalExit ? { rangeLowBars: perDay * 7, rangeLowTol: hourly ? 0.03 : 0.05, trendBars: hourly ? perDay : perDay * 3 } : {}),
      }),
      // Same sizing as Quiet; across 40 pairs this did best on 15m (30 of 40 profitable). The
      // ladder cut the worst drawdown from 99% to 54% there.
      // New Launch: the same rules at half size for a pair's first week, where rugs are likelier.
      // First 7 days of 34 pairs on 5m: 23 profitable, median +2.5% for the week, worst -17%.
      config: {
        ...DEFAULT_CONFIG,
        positionSize: launch ? 0.05 : 0.1,
        freeRideAt: signalExit ? undefined : 2,
        freeRideKeep: 0.1,
        freeLadder: FREE_LADDER,
      },
      // EMA 200 is skipped until it exists, so MACD (26 + 9 bars) sets the minimum.
      minBars: 37,
      shortLabels: signalExit ? ["Under EMAs", "MACD turn", "RSI", "Range low", "RSI swing low", "Support"] : ["Under EMAs", "MACD turn", "RSI", "Support"],
      note: launch
        ? `5% per trade · cost back at 3x · keep 10% free · for a pair's first week${resolutionMinutes === 5 ? "" : " · best on 5m"}`
        : signalExit
          ? `10% per trade · sell 10% ${hourly ? "on each new highest close" : "at each swing higher high"} · keep 10% free, sold at 10x/30x/100x`
          : `10% per trade · cost back at 3x · keep 10% free, sold at 10x/30x/100x · best on 15m`,
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
