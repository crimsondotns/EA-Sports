import type { Candle } from "../indicators.ts";

export interface Position {
  entryIndex: number;
  entryPrice: number;
  stop: number;
  highestClose: number;
  /** True once the free ride has sold the cost back; the rest is house money. */
  costRecovered: boolean;
}

export interface IndicatorSeries {
  name: string;
  values: number[];
  color: string;
  pane: "price" | "volume";
  dashed?: boolean;
}

export interface PreparedStrategy {
  /** Series to draw on the chart, aligned with the candles. */
  indicators?: IndicatorSeries[];
  /** Called on the close of bar i; a true result fills at the open of bar i + 1. */
  shouldEnter(i: number): boolean;
  /** i is the signal bar. */
  initialStop(i: number, entryPrice: number): number;
  /** Called on the close of bar i while in a position; returns the stop for bar i + 1. */
  updateStop(i: number, pos: Position): number;
  shouldTimeExit(i: number, pos: Position): boolean;
  /** Entry conditions on bar i, for display. */
  conditions?(i: number): { label: string; ok: boolean; detail: string }[];
}

export interface Strategy {
  name: string;
  prepare(candles: Candle[]): PreparedStrategy;
}

export interface BacktestConfig {
  initialCapital: number;
  /** Fraction of equity per trade. */
  positionSize: number;
  /** Per side, e.g. 0.003 = 0.3% pool fee. */
  feeRate: number;
  /** Per side, applied against us. */
  slippage: number;
  /**
   * "Free ride": once price is up this fraction from entry (e.g. 1 = +100%), sell just enough
   * to get the cost back after fees and hold the remaining tokens until the end of the data.
   */
  freeRideAt?: number;
  /**
   * With `freeRideAt`: keep only this fraction of the original tokens free (e.g. 0.1) and keep
   * trading the rest with the strategy's stop. Unset keeps everything left after the cost back.
   */
  freeRideKeep?: number;
}

export type ExitReason = "stop" | "time" | "end" | "free";

export interface Trade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  bars: number;
  returnPct: number;
  /** For "free" exits, the paper value of the kept tokens at exit. */
  pnl: number;
  reason: ExitReason;
  /** Tokens kept after taking the cost back. */
  freeQty?: number;
}

export interface BacktestResult {
  trades: Trade[];
  equity: { time: number; value: number }[];
  /** Stop level active during each bar, null when flat. */
  stops: (number | null)[];
  indicators: IndicatorSeries[];
  stats: Stats;
}

export interface Stats {
  trades: number;
  winRate: number;
  totalReturnPct: number;
  buyHoldReturnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  avgTradePct: number;
  avgWinPct: number;
  avgLossPct: number;
  avgBarsHeld: number;
  exposurePct: number;
  /** Free tokens held at the end and their value after exit costs. */
  freeQty: number;
  freeValue: number;
  realizedCash: number;
}

export const DEFAULT_CONFIG: BacktestConfig = {
  initialCapital: 1000,
  positionSize: 1,
  feeRate: 0.003,
  slippage: 0.005,
};

export function runBacktest(candles: Candle[], strategy: Strategy, cfg: BacktestConfig = DEFAULT_CONFIG): BacktestResult {
  const s = strategy.prepare(candles);
  const trades: Trade[] = [];
  const equity: BacktestResult["equity"] = [];
  const stops: BacktestResult["stops"] = [];
  let cash = cfg.initialCapital;
  let pos: (Position & { qty: number; cost: number; initialQty: number; realized: number; kept: number }) | null = null;
  let pendingEntry: number | null = null; // signal bar index
  let barsInMarket = 0;
  let freeQty = 0;

  const close = (i: number, rawPrice: number, reason: ExitReason) => {
    const p = pos!;
    const exitPrice = rawPrice * (1 - cfg.slippage);
    const proceeds = p.qty * exitPrice * (1 - cfg.feeRate);
    cash += proceeds;
    // Cash returned over the whole trade (cost back + this exit); kept free tokens are not counted.
    const returned = p.realized + proceeds;
    trades.push({
      entryTime: candles[p.entryIndex]!.time,
      exitTime: candles[i]!.time,
      entryPrice: p.entryPrice,
      exitPrice,
      bars: i - p.entryIndex + 1,
      returnPct: (returned / p.cost - 1) * 100,
      pnl: returned - p.cost,
      reason,
      ...(p.kept ? { freeQty: p.kept } : {}),
    });
    pos = null;
  };

  const takeCostBack = (i: number, rawPrice: number) => {
    const p = pos!;
    const exitPrice = rawPrice * (1 - cfg.slippage);
    const sellQty = Math.min(p.qty, p.cost / (exitPrice * (1 - cfg.feeRate)));
    const proceeds = sellQty * exitPrice * (1 - cfg.feeRate);
    cash += proceeds;
    if (cfg.freeRideKeep !== undefined) {
      // Keep a slice free, trade the rest on.
      const kept = Math.min(p.qty - sellQty, p.initialQty * cfg.freeRideKeep);
      freeQty += kept;
      p.kept = kept;
      p.qty -= sellQty + kept;
      p.realized += proceeds;
      p.costRecovered = true;
      if (p.qty <= p.initialQty * 1e-9) close(i, rawPrice, "free");
      return;
    }
    const kept = p.qty - sellQty;
    freeQty += kept;
    trades.push({
      entryTime: candles[p.entryIndex]!.time,
      exitTime: candles[i]!.time,
      entryPrice: p.entryPrice,
      exitPrice,
      bars: i - p.entryIndex + 1,
      returnPct: (exitPrice / p.entryPrice - 1) * 100,
      pnl: kept * exitPrice,
      reason: "free",
      freeQty: kept,
    });
    pos = null;
  };

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i]!;

    if (pendingEntry !== null && !pos) {
      const entryPrice = bar.open * (1 + cfg.slippage);
      const cost = cash * cfg.positionSize;
      const qty = (cost * (1 - cfg.feeRate)) / entryPrice;
      cash -= cost;
      pos = {
        entryIndex: i,
        entryPrice,
        stop: s.initialStop(pendingEntry, entryPrice),
        highestClose: bar.open,
        costRecovered: false,
        qty,
        cost,
        initialQty: qty,
        realized: 0,
        kept: 0,
      };
    }
    pendingEntry = null;

    stops.push(pos ? pos.stop : null);
    if (pos) {
      barsInMarket++;
      const target = cfg.freeRideAt === undefined || pos.costRecovered ? Infinity : pos.entryPrice * (1 + cfg.freeRideAt);
      if (bar.low <= pos.stop) {
        // Gap through the stop fills at the open.
        close(i, Math.min(bar.open, pos.stop), "stop");
      } else if (bar.high >= target) {
        takeCostBack(i, Math.max(bar.open, target));
        if (pos) {
          pos.highestClose = Math.max(pos.highestClose, bar.close);
          pos.stop = s.updateStop(i, pos);
        }
      } else {
        pos.highestClose = Math.max(pos.highestClose, bar.close);
        pos.stop = s.updateStop(i, pos);
        if (s.shouldTimeExit(i, pos)) close(i, bar.close, "time");
      }
    } else if (i < candles.length - 1 && s.shouldEnter(i)) {
      pendingEntry = i;
    }

    equity.push({ time: bar.time, value: cash + ((pos?.qty ?? 0) + freeQty) * bar.close });
  }
  if (pos) close(candles.length - 1, candles.at(-1)!.close, "end");
  // Free tokens are valued as if sold at the last close, after exit costs.
  const freeValue = freeQty * candles.at(-1)!.close * (1 - cfg.slippage) * (1 - cfg.feeRate);
  equity[equity.length - 1]!.value = cash + freeValue;

  const stats = computeStats(candles, trades, equity, barsInMarket, cfg);
  return {
    trades,
    equity,
    stops,
    indicators: s.indicators ?? [],
    stats: { ...stats, freeQty, freeValue, realizedCash: cash },
  };
}

function computeStats(
  candles: Candle[],
  trades: Trade[],
  equity: BacktestResult["equity"],
  barsInMarket: number,
  cfg: BacktestConfig,
): Omit<Stats, "freeQty" | "freeValue" | "realizedCash"> {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  let peak = -Infinity;
  let maxDd = 0;
  for (const e of equity) {
    peak = Math.max(peak, e.value);
    maxDd = Math.max(maxDd, (peak - e.value) / peak);
  }

  return {
    trades: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    totalReturnPct: (equity.at(-1)!.value / cfg.initialCapital - 1) * 100,
    buyHoldReturnPct: (candles.at(-1)!.close / candles[0]!.open - 1) * 100,
    maxDrawdownPct: maxDd * 100,
    profitFactor: grossLoss === 0 ? (grossWin > 0 ? Infinity : 0) : grossWin / grossLoss,
    avgTradePct: avg(trades.map((t) => t.returnPct)),
    avgWinPct: avg(wins.map((t) => t.returnPct)),
    avgLossPct: avg(losses.map((t) => t.returnPct)),
    avgBarsHeld: avg(trades.map((t) => t.bars)),
    exposurePct: (barsInMarket / candles.length) * 100,
  };
}
