import type { Candle } from "../indicators.ts";

export interface Position {
  entryIndex: number;
  entryPrice: number;
  stop: number;
  highestClose: number;
  /** True once the free ride has sold the cost back; the rest is house money. */
  costRecovered: boolean;
  /** Partial sells taken so far (see `partialExit`). */
  partialsSold: number;
  /** Price of the last partial sell, 0 before the first. */
  lastSellPrice: number;
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
  /**
   * Called on the close of bar i while in a position: the fraction of the original tokens to
   * sell at the open of bar i + 1 (0 = none). Sells stop once only the `freeRideKeep` slice is
   * left, which is then kept free like a cost-back bag.
   */
  partialExit?(i: number, pos: Position): number;
  /**
   * Called on the close of bar i while in a position: a resting limit sell for bar i + 1. If
   * that bar's high reaches `price`, `fraction` of the original tokens sell at the limit (or at
   * the open if it gaps above). Same free-slice rule as `partialExit`.
   */
  limitSell?(i: number, pos: Position): { price: number; fraction: number } | null;
  /** Big-picture range low at bar i and whether the market counts as an uptrend, if used. */
  rangeLow?(i: number): { price: number; uptrend: boolean } | null;
  /** Entry conditions on bar i, for display. */
  conditions?(i: number): { label: string; ok: boolean; detail: string }[];
  /**
   * The next setup to wait for, as of the close of bar i: a price zone where an entry could
   * trigger, the stop that would go with it, and what still has to happen. Not a forecast.
   */
  plan?(i: number): TradePlan | null;
  /** Support / resistance levels known at the close of bar i, for display. */
  levels?(i: number): { kind: "support" | "resistance"; price: number; touches: number; from: number }[];
}

export interface TradePlan {
  /** "zone": wait for price to come into [low, high]; "trigger": wait for a close above `high`;
   *  "below": wait for price under `high`, then for the rest of the conditions. */
  kind: "zone" | "trigger" | "below";
  low: number;
  high: number;
  stop: number;
  /** What has to happen in or at the zone for the entry to fire. */
  waitFor: string;
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
  /**
   * Exit ladder for the free tokens: when price reaches `at` x the entry price, sell `sell` of
   * the tokens originally kept free (e.g. [{at: 10, sell: 1/3}, ...]). Unset holds them to the end.
   */
  freeLadder?: { at: number; sell: number }[];
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
  /** With `freeRideKeep`: when and at what price the cost was sold back. */
  costBackTime?: number;
  costBackPrice?: number;
  /** Partial sells (see `partialExit`): fill time and price. */
  partials?: { time: number; price: number }[];
}

export interface BacktestResult {
  trades: Trade[];
  equity: { time: number; value: number }[];
  /** Stop level active during each bar, null when flat. */
  stops: (number | null)[];
  /** The position still open after the last bar (stop and highest close already updated for it), or null when flat. */
  openPosition: Position | null;
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

/** Sell the free tokens a third at a time at 10x, 30x and 100x the entry. */
export const FREE_LADDER = [
  { at: 10, sell: 1 / 3 },
  { at: 30, sell: 1 / 3 },
  { at: 100, sell: 1 / 3 },
];

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
  let pos:
    | (Position & { qty: number; cost: number; initialQty: number; realized: number; kept: number; costBack?: { time: number; price: number }; partials: { time: number; price: number }[] })
    | null = null;
  let pendingEntry: number | null = null; // signal bar index
  let pendingSell = 0; // fraction of the original tokens to sell at the next open
  let pendingLimit: { price: number; fraction: number } | null = null;
  let barsInMarket = 0;
  let freeQty = 0;
  // Each trade's free tokens, so the ladder can measure its multiple against that entry.
  const bags: { entryPrice: number; initial: number; qty: number; step: number }[] = [];
  const keepFree = (entryPrice: number, qty: number) => {
    freeQty += qty;
    if (cfg.freeLadder?.length && qty > 0) bags.push({ entryPrice, initial: qty, qty, step: 0 });
  };
  const sellLadder = (bar: Candle) => {
    for (const b of bags) {
      for (let rung = cfg.freeLadder![b.step]; rung && b.qty > 0; rung = cfg.freeLadder![b.step]) {
        const level = b.entryPrice * rung.at;
        if (bar.high < level) break;
        const qty = Math.min(b.qty, b.initial * rung.sell);
        cash += qty * Math.max(bar.open, level) * (1 - cfg.slippage) * (1 - cfg.feeRate);
        b.qty -= qty;
        freeQty -= qty;
        b.step++;
      }
    }
  };

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
      ...(p.costBack ? { costBackTime: p.costBack.time, costBackPrice: p.costBack.price } : {}),
      ...(p.partials.length ? { partials: p.partials } : {}),
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
      keepFree(p.entryPrice, kept);
      p.kept = kept;
      p.qty -= sellQty + kept;
      p.realized += proceeds;
      p.costRecovered = true;
      p.costBack = { time: candles[i]!.time, price: exitPrice };
      if (p.qty <= p.initialQty * 1e-9) close(i, rawPrice, "free");
      return;
    }
    const kept = p.qty - sellQty;
    keepFree(p.entryPrice, kept);
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
        partialsSold: 0,
        lastSellPrice: 0,
        qty,
        cost,
        initialQty: qty,
        realized: 0,
        kept: 0,
        partials: [],
      };
    }
    pendingEntry = null;

    if (bags.length) sellLadder(bar);
    let sellAt = bar.open;
    // A bar that also reaches the stop could have hit it first: no limit fill then (conservative).
    if (pos && pendingSell === 0 && pendingLimit && bar.high >= pendingLimit.price && bar.low > pos.stop) {
      pendingSell = pendingLimit.fraction;
      sellAt = Math.max(bar.open, pendingLimit.price);
    }
    pendingLimit = null;
    if (pos && pendingSell > 0) {
      // Partial exit: sell a slice of the original tokens, never into the kept free slice.
      const p = pos;
      const keep = p.initialQty * (cfg.freeRideKeep ?? 0);
      const qty = Math.min(p.qty - keep, p.initialQty * pendingSell);
      if (qty > 0) {
        const proceeds = qty * sellAt * (1 - cfg.slippage) * (1 - cfg.feeRate);
        cash += proceeds;
        p.realized += proceeds;
        p.qty -= qty;
        p.partialsSold++;
        p.lastSellPrice = sellAt;
        p.partials.push({ time: bar.time, price: sellAt * (1 - cfg.slippage) });
        if (!p.costRecovered && p.realized >= p.cost) {
          p.costRecovered = true;
          p.costBack = { time: bar.time, price: sellAt * (1 - cfg.slippage) };
        }
      }
      if (p.qty <= keep * (1 + 1e-9)) {
        // Only the free slice is left: hand it to the free bags and close the trade.
        keepFree(p.entryPrice, p.qty);
        p.kept = p.qty;
        p.qty = 0;
        close(i, sellAt, "free");
      }
    }
    pendingSell = 0;
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
        else if (i < candles.length - 1) {
          if (s.partialExit) pendingSell = s.partialExit(i, pos);
          if (s.limitSell) pendingLimit = s.limitSell(i, pos);
        }
      }
    } else if (i < candles.length - 1 && s.shouldEnter(i)) {
      pendingEntry = i;
    }

    equity.push({ time: bar.time, value: cash + ((pos?.qty ?? 0) + freeQty) * bar.close });
  }
  const openPosition: Position | null = pos
    ? { entryIndex: pos.entryIndex, entryPrice: pos.entryPrice, stop: pos.stop, highestClose: pos.highestClose, costRecovered: pos.costRecovered, partialsSold: pos.partialsSold, lastSellPrice: pos.lastSellPrice }
    : null;
  if (pos) close(candles.length - 1, candles.at(-1)!.close, "end");
  // Free tokens are valued as if sold at the last close, after exit costs.
  const freeValue = freeQty * candles.at(-1)!.close * (1 - cfg.slippage) * (1 - cfg.feeRate);
  equity[equity.length - 1]!.value = cash + freeValue;

  const stats = computeStats(candles, trades, equity, barsInMarket, cfg);
  return {
    trades,
    equity,
    stops,
    openPosition,
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
