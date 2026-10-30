// Strategies the extension can run, with the backtest settings each one is meant to use.
import { DEFAULT_CONFIG, FREE_LADDER, type BacktestConfig, type Strategy } from "../../src/backtest/engine.ts";
import { DEFAULT_PARAMS, volumeBreakout } from "../../src/strategy/volumeBreakout.ts";
import type { StudySpec } from "./messages.ts";
import { DEEP_DIP_DEFAULTS, deepDip, type DeepDipParams } from "../../src/strategy/emaMacdRsi.ts";
import { lowScore } from "../../src/strategy/lowScore.ts";

export type StrategyId = "breakout" | "dip" | "launch" | "dropvol" | "sharp" | "stretch" | "flush" | "score";

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

// EMAs sit on the price pane: overlay, so they never count as an indicator pane (pane sizing matches those).
const emaStudy = (length: number, color: string): StudySpec => ({ name: "Moving Average Exponential", inputs: { length }, color, overlay: true });

export const STRATEGY_NAMES: Record<StrategyId, string> = {
  breakout: "Volume Breakout",
  dip: "Deep Dip",
  launch: "New Launch",
  dropvol: "Drop + Volume",
  sharp: "Sharp Low",
  stretch: "Stretched Low",
  flush: "Flush Low",
  score: "Low Score",
};

export function setupStrategy(id: StrategyId, resolutionMinutes: number, variant = 3): StrategySetup {
  // Every strategy shows Volume on the price pane (like "Move to: existing pane above"), so it
  // adds no pane of its own.
  const setup = baseSetup(id, resolutionMinutes, variant);
  return { ...setup, studies: [{ name: "Volume", overlay: true }, ...setup.studies.filter((s) => s.name !== "Volume")] };
}

function baseSetup(id: StrategyId, resolutionMinutes: number, variant: number): StrategySetup {
  // A strategy saved before it was removed from the picker (Quiet Accumulation, Range Swing).
  if (!(id in STRATEGY_NAMES)) id = "dip";
  if (id === "sharp" || id === "stretch" || id === "flush" || id === "score") {
    // Swing-low entries from the 2026-10-20 research (42 pairs 15m, picked on bars before
    // 2026-09-01, $880 a trade, out of sample after 09-01 without the top pair). #3 exits.
    //   Sharp Low: fell >= 10% in 6 bars + 20-bar low + upper-half close: +$13,285, 1.5 trades/pair/month.
    //   Stretched Low: Sharp Low + close >= 2 ATR under EMA 50 (bar or 2 before): +$13,635, 16/42 pairs.
    //   Flush Low: fell >= 15% in 6 bars + close above the bottom 30% + RSI 7 < 25: +$13,650.
    //   Low Score: logistic-regression score >= -1.52 (src/strategy/lowScore.ts): +$10,428, picks
    //   true lows 18% of the time (Sharp Low 10%). Every one makes $0 on the median pair.
    const perDay = Math.max(1, Math.round(1440 / resolutionMinutes));
    const dip = setupStrategy("dip", resolutionMinutes);
    const exits: Partial<DeepDipParams> = { srLookback: perDay * 30, maxHoldBars: perDay * 30, rsiLowBars: perDay, exitMode: "signals", exitSignals: ["rsiOver"], exitNeed: 1, exitRsiOver: 80 };
    const entry: Partial<DeepDipParams> =
      id === "sharp" ? { sharpLow: 0.1 }
      : id === "stretch" ? { sharpLow: 0.1, sharpStretchAtr: 2 }
      : id === "flush" ? { sharpLow: 0.15, sharpLow20: false, sharpUpper: 0.3, sharpRsi7: 25 }
      : { sharpLow: 0.1 };
    const strategy = id === "score" ? lowScore({ threshold: -1.52 }, deepDip(exits)) : deepDip({ ...exits, ...entry });
    const labels: Record<typeof id, string[]> = {
      sharp: ["Fell 10%", "20-bar low", "Upper-half close"],
      stretch: ["Fell 10%", "20-bar low", "Upper-half close", "2 ATR under EMA 50"],
      flush: ["Fell 15%", "Close above 30%", "RSI 7 < 25"],
      score: ["Low score"],
    };
    const how: Record<typeof id, string> = {
      sharp: "fell >= 10% in 6 bars, 20-bar low, upper-half close",
      stretch: "Sharp Low and >= 2 ATR under EMA 50",
      flush: "fell >= 15% in 6 bars, close above 30% of the bar, RSI 7 < 25",
      score: "swing-low model score >= -1.52 · trained on 15m",
    };
    return {
      ...dip,
      id,
      name: STRATEGY_NAMES[id],
      strategy,
      config: setupStrategy("dip", resolutionMinutes, 3).config,
      minBars: id === "score" ? 61 : dip.minBars,
      shortLabels: labels[id],
      studies: dip.studies,
      note: `10% per trade · ${how[id]} · sell 10% on each close with RSI ≥ 80 · keep 10% free`,
    };
  }
  if (id === "dropvol") {
    // Shown next to Deep Dip for comparison on the chart: Deep Dip's checks (RSI 10-49.9) on the
    // drop bar or up to 3 bars before, the drop bar closes >= 1% under the bar before on a volume
    // peak (>= 2x the 20-bar average, highest of 20), the next bar holds its low; buy the open
    // after that. #3 exits. 41 pairs 15m from 2026-09-01 (not used to pick it), $880 a trade,
    // without the top pair: +$5,010, 2.7 trades a pair a month (sharp low: +$4,230, 1.6).
    const perDay = Math.max(1, Math.round(1440 / resolutionMinutes));
    const dip = setupStrategy("dip", resolutionMinutes);
    return {
      ...dip,
      id,
      name: STRATEGY_NAMES.dropvol,
      strategy: deepDip({
        srLookback: perDay * 30,
        maxHoldBars: perDay * 30,
        rsiLowBars: perDay,
        exitMode: "signals",
        exitSignals: ["rsiOver"],
        exitNeed: 1,
        exitRsiOver: 80,
        minRsi: 10,
        maxRsi: 49.9,
        dropPeak: 0.01,
        dropPeakVol: 2,
      }),
      config: setupStrategy("dip", resolutionMinutes, 3).config,
      shortLabels: ["Under EMAs", "MACD turn", "RSI", "Support", "Drop + vol peak", "Swing low held"],
      note: "10% per trade · drop >= 1% on a volume peak, next bar holds the low · sell 10% on each close with RSI ≥ 80 · keep 10% free",
      studies: dip.studies,
    };
  }
  if (id === "dip" || id === "launch") {
    const perDay = Math.max(1, Math.round(1440 / resolutionMinutes));
    const launch = id === "launch";
    const hourly = resolutionMinutes === 60;
    // On 15m and 1h Deep Dip runs variant #3 of the #1–#8 compared in docs/strategies/research.md (the
    // others stay available to scripts through `variant`). #3 (sell 10% on each RSI >= 80 close): over the last 30 days of 40 pairs at $880 a
    // trade it made +$58,344 on 1h (+166%) by riding the one pair that pumped, -10.5% without it.
    // Other timeframes and New Launch use #1, cost back at 3x.
    const v = !launch && (resolutionMinutes === 15 || resolutionMinutes === 60) ? variant : 1;
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
      name: STRATEGY_NAMES[id],
      strategy: deepDip({
        srLookback: perDay * 30,
        maxHoldBars: perDay * 30,
        rsiLowBars: perDay,
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
      shortLabels: ["Under EMAs", "MACD turn", "RSI", ...(v >= 7 ? ["Range low"] : []), ...(v >= 6 ? ["RSI swing low"] : []), "Support"],
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
      ],
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
