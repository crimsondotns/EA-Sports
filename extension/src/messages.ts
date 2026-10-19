import type { Bar } from "../../src/dexscreener/bars.ts";

export interface BarsSource {
  dex: string;
  chain: string;
  pairId: string;
  quoteToken: string;
  resolution: number;
  /** Bars are in market cap (chart's Mcap view) rather than price. */
  marketCap: boolean;
  url: string;
}

/** What the content script knows about the chart, for the popup. Plain data only. */
export interface Summary {
  updatedAt: number;
  strategy: string;
  strategyNote: string;
  /** In a position whose cost has already been sold back (only the house money is left). */
  costRecovered: boolean;
  pair: string;
  chain: string;
  dex: string;
  resolution: string;
  dataSource: string;
  lastClosed: number;
  signal: "buy" | "hold" | "flat";
  entryPrice: number | null;
  entryTime: number | null;
  stop: number | null;
  openPnlPct: number | null;
  conditions: { label: string; ok: boolean; detail: string }[];
  stats: { bars: number; returnPct: number; maxDdPct: number; trades: number; winRate: number; pf: number; avgWin: number; avgLoss: number };
  chartStatus: string;
  error: string | null;
  /** Next setup to wait for when flat (not a forecast). */
  plan: {
    kind: "zone" | "trigger" | "below";
    low: number;
    high: number;
    stop: number;
    /** Price where the cost would be sold back, if the strategy uses the free ride. */
    target: number | null;
    waitFor: string;
    /** How far price has to move to reach the zone / trigger, % of the last close (negative = down). */
    distancePct: number;
    inZone: boolean;
  } | null;
}

export interface Settings {
  strategy: "breakout" | "quiet" | "dip" | "launch";
  showTable: boolean;
  drawMarkers: boolean;
  notify: boolean;
  /** Add the active strategy's indicators to the chart. */
  showIndicators: boolean;
  /** Background opacity of the chart table, 0.2–1. */
  tableOpacity: number;
}

export const DEFAULT_SETTINGS: Settings = { strategy: "dip", showTable: true, drawMarkers: true, notify: true, showIndicators: true, tableOpacity: 0.6 };
export const summaryKey = (tabId: number) => `summary:${tabId}`;

// content <-> background (chrome.runtime messaging)
export type ToBackground =
  | { type: "refresh" }
  | { type: "summary"; summary: Summary }
  | { type: "barsUrl"; url: string }
  | { type: "notify"; title: string; message: string };

export type ToContent =
  | { type: "bars"; source: BarsSource; bars: Bar[] }
  | { type: "error"; message: string };

// content <-> MAIN-world inject script (window.postMessage)
export const MAIN_TAG = "ea-main";
export const CONTENT_TAG = "ea-content";

/** A bar exactly as the TradingView chart holds it (time in seconds). */
export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface DrawPayload {
  arrows: { time: number; price: number; side: "buy" | "sell"; text: string; color: string }[];
  segments: { from: { time: number; price: number }; to: { time: number; price: number }; color: string }[];
  stop: number | null;
  /** Resting limit for the next 10% sell while holding, if the strategy uses one. */
  sellLimit: number | null;
  /** Lowest low of the strategy's range window; buys outside an uptrend must be near it. */
  rangeLow: { price: number; uptrend: boolean } | null;
  /** Next setup: a zone box (or trigger line) projected into the future, with stop and target. */
  plan: { kind: "zone" | "trigger" | "below"; low: number; high: number; stop: number; target: number | null; from: number; to: number } | null;
  /** Support / resistance levels to draw as rays from where they were first touched. */
  levels: { kind: "support" | "resistance"; price: number; touches: number; time: number }[];
  /** Recent closed bars (time in seconds), used to line our times up with the chart's bars. */
  anchors: { time: number; close: number }[];
}

export type FromMain =
  | { source: typeof MAIN_TAG; type: "status"; ready: boolean; detail: string }
  | { source: typeof MAIN_TAG; type: "barsUrl"; url: string }
  | { source: typeof MAIN_TAG; type: "chartBars"; resolution: string; bars: ChartBar[]; hasVolume: boolean }
  | { source: typeof MAIN_TAG; type: "drawResult"; ok: number; failed: number; error: string | null; progress?: string; note?: string };
export type FromContent =
  | { source: typeof CONTENT_TAG; type: "draw"; payload: DrawPayload }
  | { source: typeof CONTENT_TAG; type: "clear" }
  | { source: typeof CONTENT_TAG; type: "studies"; studies: StudySpec[] };

/** A built-in TradingView indicator: `inputs` are matched by input name, case-insensitive. */
export interface StudySpec {
  name: string;
  inputs?: Record<string, number>;
  color?: string;
}
