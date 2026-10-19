// Top-frame content script: works out the ATH close, ATL and first bar from the pair's daily
// bars, sends them to the TradingView chart (drawn by inject.ts) and publishes a status for the popup.
import type { Bar } from "../../src/dexscreener/bars.ts";
import { toCandles } from "../../src/indicators.ts";
import { CONTENT_TAG, MAIN_TAG, type DrawPayload, type FromContent, type FromMain, type Status, type ToBackground, type ToContent } from "./messages.ts";

const REFRESH_MS = 20_000;
// The chart's own last close picks the price field; the feed's is the fallback when it is stale.
const CHART_PRICE_FRESH_MS = 60_000;

let chartReady = false;
let chartStatus = "Looking for the TradingView chart…";
let errorText: string | null = null;
let daily: Bar[] = [];
let feedClose: number | null = null;
let chartClose: number | null = null;
let chartCloseAt = 0;
let lastPayload: DrawPayload | null = null;
let refreshTimer: ReturnType<typeof setInterval> | undefined;

/** After the extension is reloaded, this old copy of the script can no longer talk to it. */
function send(msg: ToBackground): void {
  try {
    if (!chrome.runtime?.id) throw new Error("Extension context invalidated.");
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    clearInterval(refreshTimer);
  }
}

/** The TradingView chart lives in an iframe (possibly nested), so post to every frame. */
const postToFrames = (msg: FromContent) => {
  const walk = (w: Window, depth: number) => {
    w.postMessage(msg, "*");
    if (depth > 4) return;
    for (let i = 0; i < w.frames.length; i++) walk(w.frames[i]!, depth + 1);
  };
  walk(window, 0);
};

/** "DELTA $10.29M - Delta / WETH on Robinhood / Uniswap - DEX Screener" -> "DELTA $10.29M - Delta / WETH". */
const pairName = () =>
  document.title
    .split("|")[0]!
    .replace(/\s+-\s+DEX Screener\s*$/i, "")
    .replace(/\s+on\s+.*$/, "")
    .trim();

function publish(): void {
  const status: Status = { updatedAt: Date.now(), pair: pairName(), chartStatus, athClose: lastPayload?.ath?.close ?? null, error: errorText };
  send({ type: "status", status });
}

/** ATH close, ATL (open of the lowest close) and first bar of the daily bars, in the price field (USD or quote) that matches the chart. */
function athAtl(now: number | null): DrawPayload {
  if (!now || !daily.length) return { ath: null, atl: null, firstBar: null };
  // The open daily bar's close is the current price: use it to pick the field.
  const days = (["usd", "quote"] as const)
    .map((f) => toCandles(daily, f))
    .find((d) => d.length && Math.abs(d.at(-1)!.close / now - 1) < 0.05);
  const closed = days?.filter((d) => d.time + 86_400_000 <= Date.now()) ?? [];
  if (!closed.length) return { ath: null, atl: null, firstBar: null };
  const top = closed.reduce((a, c) => (c.close > a.close ? c : a));
  const bottom = closed.reduce((a, c) => (c.close < a.close ? c : a));
  return {
    ath: { close: top.close, time: top.time / 1000, levels: [0.9, 0.95].map((pct) => ({ pct, price: top.close * (1 - pct) })) },
    atl: { open: bottom.open, time: bottom.time / 1000 },
    firstBar: days![0]!.time / 1000,
  };
}

function draw(): void {
  if (!chartReady) return;
  const now = Date.now() - chartCloseAt < CHART_PRICE_FRESH_MS ? chartClose : feedClose;
  lastPayload = athAtl(now);
  postToFrames({ source: CONTENT_TAG, type: "draw", payload: lastPayload });
  publish();
}

chrome.runtime.onMessage.addListener((msg: ToContent) => {
  if (msg.type === "bars") {
    errorText = null;
    daily = msg.daily;
    feedClose = msg.bars.length ? toCandles(msg.bars.slice(-1), "usd")[0]!.close : null;
    draw();
  } else {
    errorText = msg.message;
    publish();
  }
});

window.addEventListener("message", (e: MessageEvent<FromMain>) => {
  if (e.data?.source !== MAIN_TAG) return;
  const msg = e.data;
  if (msg.type === "barsUrl") return send({ type: "barsUrl", url: msg.url });
  if (msg.type === "chartPrice") {
    chartClose = msg.close;
    chartCloseAt = Date.now();
    return draw();
  }
  if (msg.type === "drawResult") {
    chartStatus = msg.failed ? `Drawing: ${msg.failed} failed (${msg.error})` : lastPayload?.ath ? "Drawings up to date" : "Waiting for daily bars…";
    return publish();
  }
  if (chartReady && !msg.ready) return;
  chartReady = msg.ready;
  chartStatus = msg.ready ? `Chart found (${msg.detail})` : "Can't reach the DEX Screener chart, so nothing can be drawn.";
  publish();
  draw();
});

send({ type: "refresh" });
refreshTimer = setInterval(() => send({ type: "refresh" }), REFRESH_MS);
