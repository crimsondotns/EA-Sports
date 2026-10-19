// Top-frame content script: runs the strategy on the chart's bars, sends drawings to the
// TradingView chart (via inject.ts), shows a compact table in the chart's top-right corner
// and publishes a summary for the popup.
import type { Bar } from "../../src/dexscreener/bars.ts";
import { toCandles, type Candle } from "../../src/indicators.ts";
import { runBacktest, type BacktestResult, type Position } from "../../src/backtest/engine.ts";
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
/** "DELTA $10.29M - Delta / WETH on Robinhood / Uniswap - DEX Screener" -> "DELTA $10.29M - Delta / WETH". */
const pairName = () =>
  document.title
    .split("|")[0]!
    .replace(/\s+-\s+DEX Screener\s*$/i, "")
    .replace(/\s+on\s+.*$/, "")
    .trim();
const resLabel = (r: number) => (r >= 1440 ? `${r / 1440}D` : r >= 60 ? `${r / 60}h` : `${r}m`);

// ---------- table in the chart's top-right corner ----------

const host = document.createElement("div");
// EA Drawing shows no table: only the ATH lines are drawn.
host.style.cssText = "display:none;position:fixed;top:16px;right:16px;z-index:2147483647;pointer-events:none;";
const root = host.attachShadow({ mode: "open" });
root.innerHTML = `
<style>
  :host { all: initial; }
  table {
    border-collapse: collapse; min-width: 196px; max-width: 260px; pointer-events: auto;
    background: rgba(0, 0, 0, var(--table-opacity, .6)); color: #fff; border: 1px solid #2a2a2a; border-radius: 0;
    font: 11px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-variant-numeric: tabular-nums; overflow: hidden;
  }
  th, td { padding: 3px 10px; text-align: left; white-space: nowrap; }
  td:last-child { text-align: right; }
  thead th { padding-top: 7px; padding-bottom: 6px; font-weight: 600; border-bottom: 1px solid #2a2a2a; }
  .head { display: flex; align-items: center; gap: 8px; }
  .head #title { flex: 1; }
  thead th #title span { color: #777; font-weight: 400; margin-left: 6px; }
  #brief { font-weight: 600; }
  #toggle { all: unset; flex: none; width: 20px; height: 20px; margin: -2px -6px -2px 0; display: inline-flex;
    align-items: center; justify-content: center; border-radius: 6px; color: #b4b4b4; cursor: pointer;
    transition: background-color 140ms ease-out, color 140ms ease-out; }
  #toggle svg { width: 12px; height: 12px; transition: transform 140ms ease-out; }
  #toggle[aria-expanded="false"] svg { transform: rotate(-90deg); }
  #toggle:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
  #toggle:active { background: #2a2a2a; }
  @media (hover: hover) and (pointer: fine) { #toggle:hover { background: #202020; color: #fff; } }
  #grip { all: unset; flex: none; width: 14px; height: 20px; margin-left: -6px; display: inline-flex; align-items: center;
    justify-content: center; border-radius: 6px; color: #777; cursor: grab; touch-action: none;
    transition: background-color 140ms ease-out, color 140ms ease-out; }
  #grip svg { width: 8px; height: 12px; }
  #grip:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
  :host(.dragging) #grip { cursor: grabbing; color: #fff; }
  @media (hover: hover) and (pointer: fine) { #grip:hover { background: #202020; color: #fff; } }
  table.collapsed tbody { display: none; }
  table.collapsed thead th { border-bottom: 0; padding-bottom: 7px; }
  @media (prefers-reduced-motion: reduce) { #toggle, #toggle svg { transition: none; } }
  tr.sep td { border-top: 1px solid #2a2a2a; padding-top: 5px; }
  tbody tr:last-child td { padding-bottom: 7px; }
  .muted { color: #777; } .sub { color: #b4b4b4; }
  .ok { color: #4ade80; } .no { color: #777; } .neg { color: #f87171; } .pos { color: #4ade80; }
  .sig { font-weight: 600; }
  td.msg { white-space: normal; }
</style>
<table id="table" aria-label="EA signals"><thead><tr><th colspan="2"><div class="head"><button type="button" id="grip" aria-label="Move table up or down" title="Drag to move · double-click to reset">
    <svg viewBox="0 0 8 12" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10" r="1"/><circle cx="6" cy="10" r="1"/></g></svg>
  </button><span id="title">EA</span><span id="brief"></span>
  <button type="button" id="toggle" aria-expanded="true" aria-controls="body" aria-label="Collapse table" title="Collapse table">
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button></div></th></tr></thead><tbody id="body">
  <tr><td colspan="2" class="muted">Waiting for chart data…</td></tr>
</tbody></table>`;
document.documentElement.appendChild(host);
const $ = (id: string) => root.getElementById(id)!;

// Collapse to the header line (title + signal); remembered in settings.
function paintCollapsed(): void {
  const collapsed = settings.tableCollapsed;
  $("table").classList.toggle("collapsed", collapsed);
  const t = $("toggle");
  t.setAttribute("aria-expanded", String(!collapsed));
  t.setAttribute("aria-label", collapsed ? "Expand table" : "Collapse table");
  t.title = collapsed ? "Expand table" : "Collapse table";
}
$("toggle").addEventListener("click", () => void chrome.storage.local.set({ tableCollapsed: !settings.tableCollapsed }));

/** Offset while the table is being dragged (null otherwise); saved to settings on release. */
let dragOffset: number | null = null;

/** Pin the table inside the chart's top-right corner, left of the price scale. */
function positionTable(): void {
  const frame = document.querySelector<HTMLIFrameElement>('iframe[id^="tradingview_"]');
  const r = frame?.getBoundingClientRect();
  // Only show once the chart is on screen and there is something to say; while the chart is
  // still loading there is no corner to pin to.
  const chartReady = !!r && r.width >= 300 && r.height >= 200 && mode === "tradingview";
  host.style.display = settings.showTable && chartReady && (last || errorText) ? "" : "none";
  host.style.setProperty("--table-opacity", String(settings.tableOpacity));
  if (!chartReady) return;
  const PRICE_SCALE = 72; // width of the chart's right price axis
  const TOOLBAR = 44; // chart top toolbar
  const INSET = 16; // keep clear of the chart's edges and its legend buttons
  // The user's drag offset, kept inside the chart.
  const base = r.top + TOOLBAR + INSET;
  const maxOffset = Math.max(0, r.bottom - INSET - host.offsetHeight - base);
  const offset = Math.min(Math.max(0, dragOffset ?? settings.tableOffsetY), maxOffset);
  host.style.top = `${Math.max(0, base + offset)}px`;
  host.style.right = `${Math.max(0, window.innerWidth - r.right + PRICE_SCALE + INSET)}px`;
}
setInterval(positionTable, 500);

// Drag the grip (or use the arrow keys on it) to move the table up and down; double-click resets.
{
  const grip = $("grip");
  let startY = 0;
  let startOffset = 0;
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    grip.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startOffset = settings.tableOffsetY;
    dragOffset = startOffset;
    host.classList.add("dragging");
  });
  grip.addEventListener("pointermove", (e) => {
    if (dragOffset === null) return;
    dragOffset = Math.max(0, startOffset + e.clientY - startY);
    positionTable();
  });
  const end = () => {
    if (dragOffset === null) return;
    const top = parseFloat(host.style.top);
    host.classList.remove("dragging");
    // Save what was actually applied (clamped to the chart).
    const frame = document.querySelector<HTMLIFrameElement>('iframe[id^="tradingview_"]');
    const base = (frame?.getBoundingClientRect().top ?? 0) + 44 + 16;
    dragOffset = null;
    void chrome.storage.local.set({ tableOffsetY: Math.max(0, Math.round(top - base)) });
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  grip.addEventListener("dblclick", () => void chrome.storage.local.set({ tableOffsetY: 0 }));
  grip.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    void chrome.storage.local.set({ tableOffsetY: Math.max(0, settings.tableOffsetY + (e.key === "ArrowDown" ? 16 : -16)) });
  });
}
window.addEventListener("resize", positionTable);

function currentPlan(): Summary["plan"] {
  if (!last) return null;
  const { candles, result, setup } = last;
  if (result.trades.at(-1)?.reason === "end") return null; // holding: the position matters, not the next setup
  const i = candles.length - 1;
  const plan = setup.strategy.prepare(candles).plan?.(i);
  if (!plan) return null;
  const close = candles[i]!.close;
  return {
    ...plan,
    target: setup.config.freeRideAt === undefined ? null : plan.high * (1 + setup.config.freeRideAt),
    distancePct: (plan.high / close - 1) * 100,
    inZone: (plan.kind === "zone" && close <= plan.high && close >= plan.low) || (plan.kind === "below" && close < plan.high),
  };
}

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
    pair: pairName(),
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
    plan: currentPlan(),
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
  // Shown in the header only while collapsed, so the signal stays visible.
  const brief = $("brief");
  brief.className = sum.signal === "buy" ? "pos" : sum.signal === "hold" && sum.openPnlPct !== null && sum.openPnlPct !== undefined ? (sum.openPnlPct >= 0 ? "pos" : "neg") : "sub";
  brief.textContent = !settings.tableCollapsed ? "" : sum.signal === "buy" ? "▲ BUY" : sum.signal === "hold" ? pct(sum.openPnlPct ?? 0, 2) : "Waiting";
  const shortLabels = last?.setup.shortLabels ?? [];
  const signal =
    sum.signal === "buy"
      ? `<td class="sig pos">▲ BUY</td>`
      : sum.signal === "hold"
        ? `<td class="sig">${sum.costRecovered ? "Free ride" : "Holding"}</td>`
        : `<td class="sig sub">Waiting</td>`;
  const rows = [
    `<tr><td class="sub">Signal</td>${signal}</tr>`,
    ...(sum.signal === "hold"
      ? [
          `<tr><td class="sub">Stop</td><td class="neg">${sum.stop === null ? "–" : fmt(sum.stop)}</td></tr>`,
          `<tr><td class="sub">P/L</td><td class="${sum.openPnlPct! >= 0 ? "pos" : "neg"}">${pct(sum.openPnlPct!, 2)}</td></tr>`,
        ]
      : []),
    ...(sum.plan
      ? sum.plan.kind === "zone"
        ? [
            `<tr class="sep"><td class="sub">Next buy zone</td><td class="${sum.plan.inZone ? "pos" : ""}">${fmt(sum.plan.low)}–${fmt(sum.plan.high)}</td></tr>`,
            `<tr><td class="sub">${sum.plan.inZone ? "In zone" : "Distance"}</td><td>${sum.plan.inZone ? (sum.strategy === "Quiet Accumulation" ? "wait for reversal" : "wait for MACD turn") : pct(sum.plan.distancePct)}</td></tr>`,
            `<tr><td class="sub">Stop · Cost back</td><td>${fmt(sum.plan.stop)} · ${sum.plan.target === null ? "–" : fmt(sum.plan.target)}</td></tr>`,
          ]
        : sum.plan.kind === "below"
          ? [
              `<tr class="sep"><td class="sub">Buy below</td><td class="${sum.plan.inZone ? "pos" : ""}">${fmt(sum.plan.high)}</td></tr>`,
              `<tr><td class="sub">${sum.plan.inZone ? "Below now" : "Distance"}</td><td>${sum.plan.inZone ? "wait for MACD turn" : pct(sum.plan.distancePct)}</td></tr>`,
              `<tr><td class="sub">Stop · Cost back</td><td>${fmt(sum.plan.stop)} · ${sum.plan.target === null ? "–" : fmt(sum.plan.target)}</td></tr>`,
            ]
          : [
            `<tr class="sep"><td class="sub">Buy above</td><td>${fmt(sum.plan.high)} (${pct(sum.plan.distancePct)})</td></tr>`,
            `<tr><td class="sub">Stop</td><td>${fmt(sum.plan.stop)}</td></tr>`,
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
  // EA Drawing: no strategy indicators, markers or stop lines, only the ATH lines.
  postToFrames({ source: CONTENT_TAG, type: "studies", studies: [] });
  const candles = lastInput?.candles ?? [];
  const payload: DrawPayload = {
    arrows: [],
    segments: [],
    plan: null,
    levels: [],
    anchors: [],
    stop: null,
    rangeLow: null,
    ...athAtl(candles),
    sellLabel: "",
    sellLimit: null,
  };
  postToFrames({ source: CONTENT_TAG, type: "draw", payload });
}

/** ATH close and ATL open of the closed daily bars, in the price field (USD or quote) that matches the chart. */
function athAtl(candles: Candle[]): Pick<DrawPayload, "ath" | "atl"> {
  const now = candles.at(-1)?.close;
  if (!now || !daily.length) return { ath: null, atl: null };
  // The open daily bar's close is the current price: use it to pick the field.
  const days = (["usd", "quote"] as const)
    .map((f) => toCandles(daily, f))
    .find((d) => d.length && Math.abs(d.at(-1)!.close / now - 1) < 0.05);
  const closed = days?.filter((d) => d.time + 86_400_000 <= Date.now()) ?? [];
  if (!closed.length) return { ath: null, atl: null };
  const top = closed.reduce((a, c) => (c.close > a.close ? c : a));
  const bottom = closed.reduce((a, c) => (c.open < a.open ? c : a));
  return {
    ath: { close: top.close, time: top.time / 1000, levels: [0.9, 0.95].map((pct) => ({ pct, price: top.close * (1 - pct) })) },
    atl: { open: bottom.open, time: bottom.time / 1000 },
  };
}

function openPosition(): Position | null {
  if (!last) return null;
  const { candles, result } = last;
  const open = result.trades.at(-1);
  if (open?.reason !== "end") return null;
  return {
    entryIndex: candles.findIndex((c) => c.time === open.entryTime),
    entryPrice: open.entryPrice,
    stop: result.stops.at(-1) ?? 0,
    highestClose: open.entryPrice,
    costRecovered: open.costBackTime !== undefined,
    partialsSold: open.partials?.length ?? 0,
    lastSellPrice: open.partials?.at(-1)?.price ?? 0,
  };
}

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
  const label = `${source.chain} ${resLabel(source.resolution)} · ${pairName()}`;
  if (!inPos && strat.shouldEnter(candles.length - 1)) {
    once("buy", `EA BUY · ${last.setup.name}`, `${label}\nClose ${fmt(lastBar.close)} — buy at next bar open`);
  }
  const plan = currentPlan();
  if (plan?.inZone) {
    once("zone", `EA · price in buy zone · ${last.setup.name}`, `${label}\n${plan.kind === "below" ? `under ${fmt(plan.high)}` : `${fmt(plan.low)}–${fmt(plan.high)}`} — ${plan.waitFor}`);
  }
  // 10% signal sells keep the position open, so they never show up as an exit.
  const pos = openPosition();
  const sellPct = pos && pos.partialsSold < 9 ? (strat.partialExit?.(candles.length - 1, pos) ?? 0) : 0;
  if (pos && sellPct > 0) {
    once("partial", `EA SELL ${Math.round(sellPct * 100)}% · ${last.setup.name}`, `${label}\nClose ${fmt(lastBar.close)} (${pct((lastBar.close / pos.entryPrice - 1) * 100)}) — sell at next bar open`);
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
let daily: Bar[] = [];
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

// Timeframes the DEX Screener chart offers, in minutes.
const TIMEFRAMES = [1, 5, 15, 60, 240, 720, 1440];

/** Says which timeframe to switch to, or that the pair is too young for this strategy. */
function notEnoughBars(setup: StrategySetup, resolution: number, candles: Candle[]): string {
  const needDays = (setup.minBars * resolution) / 1440;
  const ageDays = candles.length ? (Date.now() - candles[0]!.time) / 86_400_000 : 0;
  // The chart loads roughly the same number of bars on any timeframe (so larger timeframes
  // reach further back): suggest the smallest one that needs no more bars than are loaded now.
  const fits = TIMEFRAMES.filter((tf) => tf > resolution).find((tf) => setupStrategy(setup.id, tf).minBars <= Math.max(candles.length, 300));
  if (fits) return `Not enough bars on ${resLabel(resolution)} for ${setup.name}. Switch the chart to ${resLabel(fits)}.`;
  // Already on a large timeframe: the loaded history is the pair's real age.
  if (ageDays < needDays) {
    return `${setup.name} needs about ${Math.ceil(needDays)} days of history; the chart has ${ageDays.toFixed(1)} days loaded. Scroll the chart back, or the pair may be too new.`;
  }
  return `Not enough bars on ${resLabel(resolution)} for ${setup.name}. Scroll the chart back to load more.`;
}

function analyze(source: BarsSource, all: Candle[]): void {
  // An empty export just means the chart is still loading.
  if (all.length === 0) return;
  // EA Drawing runs no strategy: the bars only pick the price field for the ATH lines.
  lastInput = { source, candles: all };
  drawOnTradingView();
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
  // The chart loads only a few days: put the feed's older history in front of its bars, in
  // whichever price field matches the chart (USD or quote, price or market cap).
  if (feed && candles.length) {
    const first = candles[0]!;
    const pick = (["usd", "quote"] as const)
      .map((f) => toCandles(feed.bars, f))
      .find((fc) => {
        const at = fc.find((x) => x.time === first.time);
        return at && Math.abs(at.close / first.close - 1) < 0.03;
      });
    if (pick) candles.unshift(...pick.filter((x) => x.time < first.time));
  }
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
  if (msg.type === "bars") {
    daily = msg.daily;
    onBars(msg.source, msg.bars);
  }
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
  paintCollapsed();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const prev = settings;
  settings = { ...settings, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])) } as Settings;
  positionTable();
  if (prev.tableCollapsed !== settings.tableCollapsed) {
    paintCollapsed();
    renderTable();
  }
  if (prev.strategy !== settings.strategy && lastInput) {
    last = null;
    analyze(lastInput.source, lastInput.candles);
  } else if (prev.drawMarkers !== settings.drawMarkers || prev.showIndicators !== settings.showIndicators) drawOnTradingView();
});

send({ type: "refresh" });
refreshTimer = setInterval(() => send({ type: "refresh" }), REFRESH_MS);
