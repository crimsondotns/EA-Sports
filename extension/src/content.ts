// Top-frame content script: runs the strategy on the chart's bars, sends drawings to the
// TradingView chart (via inject.ts), shows a compact table in the chart's top-right corner
// and publishes a summary for the popup.
import type { Bar } from "../../src/dexscreener/bars.ts";
import { toCandles, type Candle } from "../../src/indicators.ts";
import { runBacktest, type BacktestResult } from "../../src/backtest/engine.ts";
import { setupStrategy, type StrategySetup } from "./strategies.ts";
import {
  CONTENT_TAG,
  DEFAULT_SETTINGS,
  MAIN_TAG,
  type BarsSource,
  type ChartBar,
  type DrawPayload,
  type FromContent,
  type FromMain,
  type Settings,
  type Summary,
  type ToBackground,
  type ToContent,
} from "./messages.ts";

const REFRESH_MS = 20_000;
const MAX_DRAWN_TRADES = 60;

type ChartMode = "searching" | "tradingview" | "unavailable";

let mode: ChartMode = "searching";
let chartStatus = "Looking for the TradingView chart…";
let errorText: string | null = null;
let last: { source: BarsSource; candles: Candle[]; result: BacktestResult; setup: StrategySetup } | null = null;
// Latest bars before the closed-bar filter, so a strategy switch can re-run without waiting.
let lastInput: { source: BarsSource; candles: Candle[] } | null = null;
let settings: Settings = { ...DEFAULT_SETTINGS };
const notified = new Set<string>();

let refreshTimer: ReturnType<typeof setInterval> | undefined;

/** After the extension is reloaded, this old copy of the script can no longer talk to it. */
function send(msg: ToBackground): void {
  try {
    if (!chrome.runtime?.id) throw new Error("Extension context invalidated.");
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    clearInterval(refreshTimer);
    errorText = "The extension was reloaded — refresh this page.";
    renderTable();
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

const fmt = (v: number) => (v === 0 ? "0" : Math.abs(v) >= 1e5 ? `${(v / 1e6).toFixed(3)}M` : Math.abs(v) >= 1 ? v.toFixed(4) : v.toPrecision(4));
const pct = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
const resLabel = (r: number) => (r >= 1440 ? `${r / 1440}D` : r >= 60 ? `${r / 60}h` : `${r}m`);

// ---------- table in the chart's top-right corner ----------

const host = document.createElement("div");
host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;pointer-events:none;";
const root = host.attachShadow({ mode: "open" });
root.innerHTML = `
<style>
  :host { all: initial; }
  table {
    border-collapse: collapse; min-width: 196px; max-width: 260px; pointer-events: auto;
    background: rgba(0, 0, 0, .62); color: #fff; border: 1px solid #2a2a2a; border-radius: 10px;
    font: 11px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-variant-numeric: tabular-nums; overflow: hidden;
  }
  th, td { padding: 3px 10px; text-align: left; white-space: nowrap; }
  td:last-child { text-align: right; }
  thead th { padding-top: 7px; padding-bottom: 6px; font-weight: 600; border-bottom: 1px solid #2a2a2a; }
  thead th span { color: #777; font-weight: 400; margin-left: 6px; }
  tr.sep td { border-top: 1px solid #2a2a2a; padding-top: 5px; }
  tbody tr:last-child td { padding-bottom: 7px; }
  .muted { color: #777; } .sub { color: #b4b4b4; }
  .ok { color: #4ade80; } .no { color: #777; } .neg { color: #f87171; } .pos { color: #4ade80; }
  .sig { font-weight: 600; }
  td.msg { white-space: normal; }
</style>
<table aria-label="EA Volume Breakout"><thead><tr><th colspan="2" id="title">EA</th></tr></thead><tbody id="body">
  <tr><td colspan="2" class="muted">Waiting for chart data…</td></tr>
</tbody></table>`;
document.documentElement.appendChild(host);
const $ = (id: string) => root.getElementById(id)!;

/** Pin the table inside the chart's top-right corner, left of the price scale. */
function positionTable(): void {
  const frame = document.querySelector<HTMLIFrameElement>('iframe[id^="tradingview_"]');
  const r = frame?.getBoundingClientRect();
  // Only show once the chart is on screen and there is something to say; while the chart is
  // still loading there is no corner to pin to.
  const chartReady = !!r && r.width >= 300 && r.height >= 200 && mode === "tradingview";
  host.style.display = settings.showTable && chartReady && (last || errorText) ? "" : "none";
  if (!chartReady) return;
  const PRICE_SCALE = 72; // width of the chart's right price axis
  const TOOLBAR = 44; // chart top toolbar
  const INSET = 16; // keep clear of the chart's edges and its legend buttons
  host.style.top = `${Math.max(0, r.top + TOOLBAR + INSET)}px`;
  host.style.right = `${Math.max(0, window.innerWidth - r.right + PRICE_SCALE + INSET)}px`;
}
setInterval(positionTable, 500);
window.addEventListener("resize", positionTable);

function summarize(): Summary | null {
  if (!last) return null;
  const { source, candles, result, setup } = last;
  const s = result.stats;
  const strat = setup.strategy.prepare(candles);
  const i = candles.length - 1;
  const lastTrade = result.trades.at(-1);
  const inPos = lastTrade?.reason === "end";
  return {
    updatedAt: Date.now(),
    strategy: setup.name,
    strategyNote: setup.note,
    costRecovered: inPos && lastTrade!.costBackTime !== undefined,
    pair: document.title.split("|")[0]!.trim(),
    chain: source.chain,
    dex: source.dex,
    resolution: resLabel(source.resolution),
    dataSource: usingChartBars ? `chart bars${usingChartBars.hasVolume ? "" : " (volume from feed)"}` : "feed bars",
    lastClosed: candles[i]!.time,
    signal: !inPos && strat.shouldEnter(i) ? "buy" : inPos ? "hold" : "flat",
    entryPrice: inPos ? lastTrade!.entryPrice : null,
    entryTime: inPos ? lastTrade!.entryTime : null,
    stop: inPos ? (result.stops.at(-1) ?? null) : null,
    openPnlPct: inPos ? (candles[i]!.close / lastTrade!.entryPrice - 1) * 100 : null,
    conditions: strat.conditions?.(i) ?? [],
    stats: {
      bars: candles.length,
      returnPct: s.totalReturnPct,
      maxDdPct: s.maxDrawdownPct,
      trades: s.trades,
      winRate: s.winRate,
      pf: s.profitFactor,
      avgWin: s.avgWinPct,
      avgLoss: s.avgLossPct,
    },
    chartStatus,
    error: errorText,
  };
}

function renderTable(): void {
  positionTable();
  const sum = summarize();
  if (errorText && !sum) {
    $("body").innerHTML = `<tr><td colspan="2" class="neg msg">${errorText}</td></tr>`;
    return;
  }
  if (!sum) return;
  $("title").innerHTML = `EA · ${sum.resolution}<span>${sum.strategy}</span>`;
  const shortLabels = last?.setup.shortLabels ?? [];
  const signal =
    sum.signal === "buy"
      ? `<td class="sig pos">▲ BUY</td>`
      : sum.signal === "hold"
        ? `<td class="sig">● ${sum.costRecovered ? "Free ride" : "Holding"}</td>`
        : `<td class="sig sub">Waiting</td>`;
  const rows = [
    `<tr><td class="sub">Signal</td>${signal}</tr>`,
    ...(sum.signal === "hold"
      ? [
          `<tr><td class="sub">Stop</td><td class="neg">${sum.stop === null ? "–" : fmt(sum.stop)}</td></tr>`,
          `<tr><td class="sub">P/L</td><td class="${sum.openPnlPct! >= 0 ? "pos" : "neg"}">${pct(sum.openPnlPct!, 2)}</td></tr>`,
        ]
      : []),
    ...sum.conditions.map(
      (c, k) =>
        `<tr${k === 0 ? ' class="sep"' : ""}><td class="sub">${shortLabels[k] ?? c.label}</td><td class="${c.ok ? "ok" : "no"}">${c.ok ? "✓" : "✕"} ${c.detail.split(" vs ")[0]}</td></tr>`,
    ),
    `<tr class="sep"><td class="sub">Backtest</td><td class="${sum.stats.returnPct >= 0 ? "pos" : "neg"}">${pct(sum.stats.returnPct)}</td></tr>`,
    `<tr><td class="sub">Max DD · Trades</td><td>${sum.stats.maxDdPct.toFixed(1)}% · ${sum.stats.trades}</td></tr>`,
    ...(errorText ? [`<tr class="sep"><td colspan="2" class="neg msg">${errorText}</td></tr>`] : []),
  ];
  $("body").innerHTML = rows.join("");
}

function publish(): void {
  renderTable();
  const summary = summarize();
  if (summary) send({ type: "summary", summary });
}

// ---------- drawing on the TradingView chart ----------

function drawOnTradingView(): void {
  if (mode !== "tradingview") return;
  if (!settings.drawMarkers || !last) {
    postToFrames({ source: CONTENT_TAG, type: "clear" });
    return;
  }
  const { candles, result } = last;
  const sec = (ms: number) => Math.floor(ms / 1000);
  const byTime = new Map(candles.map((c) => [c.time, c]));
  // Keep markers just outside the candle so they don't sit on top of it.
  const below = (t: number) => {
    const c = byTime.get(t)!;
    return c.low - (c.high - c.low) * 0.3;
  };
  const above = (t: number) => {
    const c = byTime.get(t)!;
    return c.high + (c.high - c.low) * 0.3;
  };
  const trades = result.trades.slice(-MAX_DRAWN_TRADES);
  const payload: DrawPayload = {
    arrows: trades.flatMap((tr) => [
      { time: sec(tr.entryTime), price: below(tr.entryTime), side: "buy" as const, text: "BUY", color: "#2196f3" },
      ...(tr.costBackTime !== undefined
        ? [{ time: sec(tr.costBackTime), price: above(tr.costBackTime), side: "sell" as const, text: "COST BACK", color: "#fbbf24" }]
        : []),
      ...(tr.reason === "end"
        ? []
        : [
            {
              time: sec(tr.exitTime),
              price: above(tr.exitTime),
              side: "sell" as const,
              text: pct(tr.returnPct),
              color: tr.pnl > 0 ? "#26a69a" : "#ef5350",
            },
          ]),
    ]),
    segments: [],
    anchors: candles.slice(-300).map((c) => ({ time: sec(c.time), close: c.close })),
    stop: result.trades.at(-1)?.reason === "end" ? (result.stops.at(-1) ?? null) : null,
  };
  postToFrames({ source: CONTENT_TAG, type: "draw", payload });
}

// ---------- notifications ----------

function notifySignals(): void {
  if (!last) return;
  const { source, candles, result } = last;
  const lastBar = candles.at(-1)!;
  const key = (kind: string) => `${source.chain}:${source.pairId}:${source.resolution}:${lastBar.time}:${kind}`;
  const once = (kind: string, title: string, message: string) => {
    if (notified.has(key(kind))) return;
    notified.add(key(kind));
    if (settings.notify) send({ type: "notify", title, message });
  };
  // Skip the first load so opening a page doesn't fire old signals.
  if (!notifySignals.armed) {
    notifySignals.armed = true;
    return;
  }
  const strat = last.setup.strategy.prepare(candles);
  const t = result.trades.at(-1);
  const inPos = t?.reason === "end";
  const label = `${source.chain} ${resLabel(source.resolution)} · ${document.title.split("|")[0]!.trim()}`;
  if (!inPos && strat.shouldEnter(candles.length - 1)) {
    once("buy", `EA BUY · ${last.setup.name}`, `${label}\nClose ${fmt(lastBar.close)} — buy at next bar open`);
  }
  if (t && t.reason !== "end" && t.exitTime === lastBar.time) {
    once("sell", `EA SELL (${t.reason})`, `${label}\n${pct(t.returnPct, 2)}`);
  }
}
notifySignals.armed = false;

// ---------- data flow ----------

// Bars from the feed request we captured. Used for volume when the chart has no Volume
// study, and as the data source until the chart's own bars arrive.
let fetched: { source: BarsSource; bars: Bar[] } | null = null;
let chartBarsAt = 0;
let usingChartBars: { hasVolume: boolean } | null = null;
const CHART_BARS_FRESH_MS = 60_000;

/** "5" -> 5, "60" -> 60, "1D"/"D" -> 1440, "1W"/"W" -> 10080 (minutes). */
function parseResolution(r: string): number {
  const m = /^(\d*)([DWM]?)$/i.exec(r.trim());
  if (!m) return NaN;
  const n = Number(m[1] || 1);
  return { "": n, D: n * 1440, W: n * 10080, M: n * 43200 }[m[2]!.toUpperCase()] ?? NaN;
}

function analyze(source: BarsSource, all: Candle[]): void {
  // An empty export just means the chart is still loading.
  if (all.length === 0) return;
  lastInput = { source, candles: all };
  const setup = setupStrategy(settings.strategy, source.resolution);
  const barMs = source.resolution * 60_000;
  // Drop the still-forming bar: signals are only valid on closed bars.
  const candles = all.filter((c) => c.time + barMs <= Date.now());
  const sameChart =
    last &&
    last.source.pairId === source.pairId &&
    last.source.resolution === source.resolution &&
    last.source.marketCap === source.marketCap &&
    last.setup.id === setup.id;
  // Small incremental responses would replace the full history; keep what we have.
  if (sameChart && candles.length < last!.candles.length / 2) return;
  if (candles.length < setup.minBars) {
    errorText = `${setup.name} needs ${setup.minBars}+ bars on ${resLabel(source.resolution)} (chart has ${candles.length}). Scroll back to load more, or use a larger timeframe.`;
    publish();
    return;
  }
  errorText = null;
  if (!sameChart) notifySignals.armed = false;
  last = { source, candles, result: runBacktest(candles, setup.strategy, setup.config), setup };
  publish();
  drawOnTradingView();
  notifySignals();
}

function onBars(source: BarsSource, bars: Bar[]): void {
  fetched = { source, bars };
  // The chart's own bars are authoritative; only fall back to the feed when they're missing.
  if (Date.now() - chartBarsAt < CHART_BARS_FRESH_MS) return;
  analyze(source, toCandles(bars, "usd"));
}

function onChartBars(resolution: string, bars: ChartBar[], hasVolume: boolean): void {
  const res = parseResolution(resolution);
  if (!Number.isFinite(res) || bars.length === 0) return;
  chartBarsAt = Date.now();
  const feed = fetched?.source.resolution === res ? fetched : null;
  const feedVolume = new Map((feed?.bars ?? []).map((b) => [b.timestamp, Number(b.volumeUsd ?? 0)]));
  const candles: Candle[] = bars.map((b) => ({
    time: b.time * 1000,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volumeUsd: b.volume ?? feedVolume.get(b.time * 1000) ?? 0,
  }));
  const pair = location.pathname.split("/").filter(Boolean);
  const source: BarsSource = feed?.source ?? {
    dex: "",
    chain: pair[0] ?? "",
    pairId: pair[1] ?? "",
    quoteToken: "",
    resolution: res,
    marketCap: false,
    url: "",
  };
  usingChartBars = { hasVolume };
  analyze({ ...source, resolution: res }, candles);
}

chrome.runtime.onMessage.addListener((msg: ToContent) => {
  if (msg.type === "bars") onBars(msg.source, msg.bars);
  else {
    errorText = msg.message;
    publish();
  }
});

window.addEventListener("message", (e: MessageEvent<FromMain>) => {
  if (e.data?.source !== MAIN_TAG) return;
  const msg = e.data;
  if (msg.type === "chartBars") return onChartBars(msg.resolution, msg.bars, msg.hasVolume);
  if (msg.type === "barsUrl") return send({ type: "barsUrl", url: msg.url });
  if (msg.type === "drawResult") {
    chartStatus = msg.progress
      ? `Drawing: ${msg.progress}`
      : `${msg.ok} markers drawn` + (msg.failed ? `, ${msg.failed} failed (${msg.error})` : "") + (msg.note ? ` · ${msg.note}` : "");
    publish();
    return;
  }
  if (mode === "tradingview" && !msg.ready) return;
  mode = msg.ready ? "tradingview" : "unavailable";
  chartStatus = msg.ready ? `Chart found (${msg.detail})` : "Can't reach the DEX Screener chart — markers can't be drawn.";
  publish();
  drawOnTradingView();
});

// ---------- settings ----------

void chrome.storage.local.get(DEFAULT_SETTINGS).then((s) => {
  settings = s as Settings;
  positionTable();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const prev = settings;
  settings = { ...settings, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])) } as Settings;
  positionTable();
  if (prev.strategy !== settings.strategy && lastInput) {
    last = null;
    analyze(lastInput.source, lastInput.candles);
  } else if (prev.drawMarkers !== settings.drawMarkers) drawOnTradingView();
});

send({ type: "refresh" });
refreshTimer = setInterval(() => send({ type: "refresh" }), REFRESH_MS);
