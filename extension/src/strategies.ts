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

export function setupStrategy(id: StrategyId, resolutionMinutes: number, variant = 3): StrategySetup {
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
    const hourly = resolutionMinutes === 60;
    // On 15m and 1h Deep Dip runs variant #3 of the #1–#8 compared in docs/strategies.md (the
    // others stay available to scripts through `variant`). #3 (sell 10% on each RSI >= 80 close): over the last 30 days of 40 pairs at $880 a
    // trade it made +$58,344 on 1h (+166%) by riding the one pair that pumped, -10.5% without it.
    // Other timeframes and New Launch use #1, cost back at 3x.
    const v = !launch && (resolutionMinutes === 15 || resolutionMinutes === 60) ? variant : 1;
    const dropPeak = !launch && resolutionMinutes === 15;
    const signalExit = v >= 2;
    const exit =
      v === 2 ? { exitSignals: ["climaxTurn" as const], exitNeed: 1 }
      : v === 3 ? { exitSignals: ["rsiOver" as const], exitNeed: 1, exitRsiOver: 80 }
      : { exitSignals: [], hhExit: hourly ? ("close" as const) : ("swing" as const), hhPivot: 2 };
    const rangeLow = v === 7 ? { rangeLowBars: perDay * 7, rangeLowTol: hourly ? 0.03 : 0.05, trendBars: hourly ? perDay : perDay * 3 }
      : v === 8 ? { rangeLowBars: perDay * 7, rangeLowTol: 0.03, trendBars: 0 }
      : {};
    const exitNote =
      v === 2 ? "sell 10% at each climax turn"
      : v === 3 ? "sell 10% on each close with RSI ≥ 80"
      : `sell 10% ${hourly ? "on each new highest close" : "at each swing higher high"}${v === 4 ? " · stop to entry after the first sell" : ""}`;
    return {
      id,
      name: v === 1 || launch ? STRATEGY_NAMES[id] : `${STRATEGY_NAMES[id]} #${v}`,
      strategy: deepDip({
        srLookback: perDay * 30,
        maxHoldBars: perDay * 30,
        rsiLowBars: perDay,
        // Trial (2026-10-20): RSI band 10–49.9 instead of 30–60 on Deep Dip, to buy deeper dips.
        // ASTEROID + CASHCAT at $880 a trade: 15m +$289 -> -$500, 1h +$1,032 -> +$1,062.
        ...(launch ? {} : { minRsi: 10, maxRsi: 49.9 }),
        // Trial (2026-10-20), 15m only: buy the capitulation swing low (drop >= 1% on a volume
        // peak, next bar holds its low, Deep Dip checks within the 3 bars before). ARROW, CASHCAT,
        // INU, ORBIO at $880 a trade: last 31 days -$955 -> -$122, after day 30 +$731 -> +$2,633.
        ...(dropPeak ? { dropPeak: 0.01, dropPeakVol: 2 } : {}),
        ...(signalExit ? { exitMode: "signals" as const, ...exit } : {}),
        ...(v >= 5 ? { breakevenAt: null } : {}),
        ...(v >= 6 ? { rsiSwing: 2, rsiSwingWithin: 6 } : {}),
        ...rangeLow,
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
      shortLabels: ["Under EMAs", "MACD turn", "RSI", ...(v >= 7 ? ["Range low"] : []), ...(v >= 6 ? ["RSI swing low"] : []), "Support", ...(dropPeak ? ["Drop + vol peak", "Swing low held"] : [])],
      note: launch
        ? `5% per trade · cost back at 3x · keep 10% free · for a pair's first week${resolutionMinutes === 5 ? "" : " · best on 5m"}`
        : signalExit
          ? `10% per trade · ${exitNote} · keep 10% free, sold at 10x/30x/100x`
          : `10% per trade · cost back at 3x · keep 10% free, sold at 10x/30x/100x · best on 15m`,
      studies: [
        emaStudy(DEEP_DIP_DEFAULTS.emaFast, "#fbbf24"),
        emaStudy(DEEP_DIP_DEFAULTS.emaMid, "#2196f3"),
        emaStudy(DEEP_DIP_DEFAULTS.emaSlow, "#ffffff"),
        // New panes stack downwards in creation order: RSI, then MACD under it.
        { name: "Relative Strength Index", inputs: { length: 14 } },
        { name: "MACD" },
        // The capitulation entry reads volume; the chart only exports it with this study on.
        ...(dropPeak ? [{ name: "Volume" }] : []),
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
