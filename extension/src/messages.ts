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
export interface Status {
  updatedAt: number;
  pair: string;
  chartStatus: string;
  /** ATH close of the closed daily bars, if known. */
  athClose: number | null;
  error: string | null;
}

export const statusKey = (tabId: number) => `status:${tabId}`;

// content <-> background (chrome.runtime messaging)
export type ToBackground =
  | { type: "refresh" }
  | { type: "status"; status: Status }
  | { type: "barsUrl"; url: string };

export type ToContent =
  | { type: "bars"; source: BarsSource; bars: Bar[]; daily: Bar[] }
  | { type: "error"; message: string };

// content <-> MAIN-world inject script (window.postMessage)
export const MAIN_TAG = "ea-main";
export const CONTENT_TAG = "ea-content";

export interface DrawPayload {
  /** Highest close of a closed daily bar (ATH close) and lines 90% / 95% below it. */
  ath: { close: number; time: number; levels: { pct: number; price: number }[] } | null;
  /** Open of the closed daily bar with the lowest close (ATL), the start of the Fib retracement to the ATH close. */
  atl: { open: number; time: number } | null;
  /** Time (s) of the pair's first daily bar, where the Anchored VWAP starts. */
  firstBar: number | null;
}

export type FromMain =
  | { source: typeof MAIN_TAG; type: "status"; ready: boolean; detail: string }
  | { source: typeof MAIN_TAG; type: "barsUrl"; url: string }
  /** Close of the chart's last bar, in whatever field (USD / quote, price / market cap) the chart shows. */
  | { source: typeof MAIN_TAG; type: "chartPrice"; close: number }
  | { source: typeof MAIN_TAG; type: "drawResult"; failed: number; error: string | null };
export type FromContent = { source: typeof CONTENT_TAG; type: "draw"; payload: DrawPayload };
