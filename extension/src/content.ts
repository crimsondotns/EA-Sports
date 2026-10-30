// Top-frame content script: runs the strategy on the chart's bars, sends drawings to the
// TradingView chart (via inject.ts), shows a compact table in the chart's top-right corner
// and publishes a summary for the popup.
import type { Bar } from "../../src/dexscreener/bars.ts";
import { toCandles, type Candle } from "../../src/indicators.ts";
import { runBacktest, type BacktestResult } from "../../src/backtest/engine.ts";
import { setupStrategy, type StrategySetup } from "./strategies.ts";
import { L, setLang, tr, translatePage } from "./i18n.ts";
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

const MAX_DRAWN_TRADES = 200;

type ChartMode = "searching" | "tradingview" | "unavailable";

let mode: ChartMode = "searching";
let chartStatus = "Looking for the TradingView chart…";
let errorText: string | null = null;
let last: { source: BarsSource; candles: Candle[]; result: BacktestResult; setup: StrategySetup } | null = null;
// Latest bars before the closed-bar filter, so a strategy switch can re-run without waiting.
let lastInput: { source: BarsSource; candles: Candle[] } | null = null;
let settings: Settings = { ...DEFAULT_SETTINGS };
const notified = new Set<string>();


/** After the extension is reloaded, this old copy of the script can no longer talk to it. */
function send(msg: ToBackground): void {
  try {
    if (!chrome.runtime?.id) throw new Error("Extension context invalidated.");
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
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

// Compact like the chart's axis: 54.58K, 50.20M, 1.234B; small prices keep 4 significant digits.
const fmt = (v: number) => {
  const a = Math.abs(v);
  return v === 0 ? "0" : a >= 1e9 ? `${(v / 1e9).toFixed(3)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(2)}K` : a >= 1 ? v.toFixed(4) : v.toPrecision(4);
};
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
host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;pointer-events:none;";
const root = host.attachShadow({ mode: "open" });
root.innerHTML = `
<style>
  /* Design G: a pill with the buy-check gate and the state; click it to open the details card.
     Dark and light follow the theme setting (Settings → Appearance in the popup). */
  :host { all: initial;
    --bg: 0 0 0; --text: #f2f2f2; --text-2: #a3a3a3; --muted: #6b6b6b; --line: #262626; --hover: #202020;
    --go: #4ade80; --stop: #f87171; --near: #fbbf24; --invert: #fff; --on-invert: #000; }
  :host(.light) { --bg: 245 246 248; --text: #14161a; --text-2: #4a505a; --muted: #6b717c; --line: #e3e6eb; --hover: #e9ecf0;
    --go: #0e9f6e; --stop: #d92d20; --near: #b54708; --invert: #14161a; --on-invert: #fff; }
  /* One panel: the pill row is its header and the details open inside it, under a hairline. */
  #table { display: grid; pointer-events: auto; color: var(--text); width: max-content;
    border-radius: 16px; background: rgb(var(--bg) / clamp(.72, var(--table-opacity, .78), .88)); overflow: hidden;
    /* Frosted glass, like the popup dropdowns: blur what is behind, hairline edge, soft deep shadow. */
    -webkit-backdrop-filter: blur(var(--table-blur, 24px)) saturate(140%); backdrop-filter: blur(var(--table-blur, 24px)) saturate(140%);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 10%), 0 12px 40px rgb(0 0 0 / 45%);
    font: 600 12px/16px "Manrope", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-variant-numeric: tabular-nums; }

  /* A see-through light card over the dark chart turns grey and the dark text drowns in it, so light stays at least 80% (white glass). */
  :host(.light) #table { background: rgb(255 255 255 / max(var(--table-opacity, .78), .8));
    box-shadow: inset 0 0 0 1px rgb(20 22 26 / 8%), 0 12px 40px rgb(0 0 0 / 30%); }
  #table.collapsed { min-width: 0; border-radius: 999px; }
  .pill { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 12px; }
  #table:not(.collapsed) .pill { padding: 12px 12px 8px 16px; align-items: baseline; }
  #table:not(.collapsed) #grip, #table:not(.collapsed) #toggle { align-self: center; }
  #title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  #badge { border-radius: 999px; padding: 4px 8px; font-weight: 800; font-size: 12px; background: var(--invert); color: var(--on-invert); }
  /* P/L shows as coloured text, no fill. */
  #badge.pos, #badge.neg { background: none; padding: 4px; } #badge.pos { color: var(--go); } #badge.neg { color: var(--stop); }
  #seg { display: flex; gap: 4px; } #seg i { width: 12px; height: 4px; border-radius: 2px; background: var(--line); } #seg i.ok { background: var(--go); }
  #brief { font-weight: 800; }
  #title { color: var(--text-2); font-weight: 500; font-size: 12px; white-space: nowrap; }
  #toggle, #grip { all: unset; flex: none; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px;
    color: var(--text-2); cursor: pointer; transition: background-color 140ms ease-out, color 140ms ease-out; }
  #toggle { width: 24px; height: 24px; }
  #toggle svg { width: 12px; height: 12px; transition: transform 140ms ease-out; }
  #toggle[aria-expanded="false"] svg { transform: rotate(-90deg); }
  #grip { width: 16px; height: 24px; color: var(--muted); cursor: grab; touch-action: none; }
  #grip svg { width: 8px; height: 12px; }
  #toggle:focus-visible, #grip:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
  #toggle:active { background: var(--hover); }
  :host(.dragging) #grip { cursor: grabbing; color: var(--text); }
  @media (hover: hover) and (pointer: fine) { #toggle:hover, #grip:hover { background: var(--hover); color: var(--text); } }
  #body { padding: 4px 16px 16px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; font-weight: 500; font-size: 13px; line-height: 20px; }
  #table.collapsed #body { display: none; }
  .r { display: flex; justify-content: space-between; gap: 12px; white-space: nowrap; }
  .r > span:first-child { flex: none; } .r > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: right; }
  .r > span:first-child { color: var(--text-2); }
  .sep { margin-top: 8px; }
  /* Checklist (table option 5): opened, the count is the headline and the buy checks read as a list of round marks. */
  #table:not(.collapsed) { width: 268px; grid-template-columns: minmax(0, 1fr); }
  #table:not(.collapsed) #badge { background: none; padding: 0; font-size: 22px; line-height: 28px; letter-spacing: -.02em; }
  #table:not(.collapsed) #badge:not(.pos):not(.neg) { color: var(--text); }
  #table:not(.collapsed) #seg { display: none; }
  .lbl { font-size: 11px; font-weight: 700; color: var(--muted); line-height: 16px; margin: 12px 0 4px; }
  .c { display: grid; grid-template-columns: 16px auto minmax(0, 1fr); gap: 8px; align-items: center; white-space: nowrap; }
  .c i { width: 14px; height: 14px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--muted); display: grid; place-items: center;
    font: 800 9px/1 "Manrope", ui-sans-serif, system-ui, sans-serif; font-style: normal; }
  .c i.ok { box-shadow: none; background: var(--go); color: var(--on-invert); }
  .c > span:nth-child(2) { color: var(--text-2); }
  .c > span:nth-child(3) { min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: right; }
  .muted { color: var(--muted); } .sub { color: var(--text-2); }
  .ok, .pos { color: var(--go); } .no { color: var(--near); } .neg { color: var(--stop); }
  .msg { white-space: normal; color: var(--text-2); }
  .msg.neg { color: var(--stop); }
  @media (prefers-reduced-motion: reduce) { #toggle, #toggle svg, #grip { transition: none; } }
</style>
<div id="table" role="group" aria-label="EA signals">
  <div class="pill"><span id="badge">EA</span><span id="seg" aria-hidden="true"></span><span id="brief">Loading</span><span id="title"></span>
  <button type="button" id="grip" aria-label="Move up or down" title="Drag to move · double-click to reset">
    <svg viewBox="0 0 8 12" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/><circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/><circle cx="2" cy="10" r="1"/><circle cx="6" cy="10" r="1"/></g></svg>
  </button><button type="button" id="toggle" aria-expanded="true" aria-controls="body" aria-label="Hide details" title="Hide details">
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button></div>
  <div id="body"><div class="r muted">Waiting for chart data…</div></div>
</div>`;
// Manrope ships with the extension; register it for the page so the shadow root can use it.
try {
  void new FontFace("Manrope", `url(${chrome.runtime.getURL("fonts/manrope.ttf")})`, { weight: "400 800" }).load().then((f) => document.fonts.add(f)).catch(() => {});
} catch {
  // extension context gone: the system font is used
}
document.documentElement.appendChild(host);
const $ = (id: string) => root.getElementById(id)!;

// Collapse to the header line (title + signal); remembered in settings.
function paintCollapsed(): void {
  const collapsed = settings.tableCollapsed;
  $("table").classList.toggle("collapsed", collapsed);
  const t = $("toggle");
  t.setAttribute("aria-expanded", String(!collapsed));
  t.setAttribute("aria-label", tr(collapsed ? "Show details" : "Hide details"));
  t.title = tr(collapsed ? "Show details" : "Hide details");
}
// Toggle right away, then save: after the extension is reloaded this old content script can't
// reach chrome.storage any more (the call throws), and the button used to do nothing then.
$("toggle").addEventListener("click", () => {
  settings = { ...settings, tableCollapsed: !settings.tableCollapsed };
  paintCollapsed();
  renderTable();
  try {
    void chrome.storage.local.set({ tableCollapsed: settings.tableCollapsed }).catch(() => {});
  } catch {
    // extension context invalidated: the page needs a refresh to save settings again
  }
});

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
  host.style.setProperty("--table-blur", `${Math.min(32, Math.max(0, settings.tableBlur))}px`);
  host.classList.toggle("light", settings.theme === "light");
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

const row = (k: string, v: string, cls = "", sep = false) => `<div class="r${sep ? " sep" : ""}"><span>${tr(k)}</span><span class="${cls}" title="${v}">${v}</span></div>`;

function renderTable(): void {
  positionTable();
  const sum = summarize();
  if (errorText && !sum) {
    $("body").innerHTML = `<div class="msg neg">${tr(errorText)}</div>`;
    return;
  }
  if (!sum) return;
  const shortLabels = last?.setup.shortLabels ?? [];
  const ok = sum.conditions.filter((c) => c.ok).length;
  const hold = sum.signal === "hold";
  const pnl = sum.openPnlPct ?? 0;
  // The pill: badge (checks passed, or open P/L), mini gate, state, strategy and timeframe.
  const badge = $("badge");
  badge.className = sum.signal === "buy" ? "pos" : hold ? (pnl >= 0 ? "pos" : "neg") : "";
  badge.textContent = hold ? pct(pnl, 1) : `${ok}/${sum.conditions.length}`;
  $("seg").innerHTML = hold ? "" : sum.conditions.map((c) => `<i class="${c.ok ? "ok" : ""}"></i>`).join("");
  const brief = $("brief");
  brief.className = sum.signal === "buy" ? "pos" : "";
  brief.textContent = tr(sum.signal === "buy" ? "Buy" : hold ? (sum.costRecovered ? "Free ride" : "Holding") : "Waiting");
  $("title").textContent = `${sum.strategy} ${sum.resolution}`;
  // The card: the trade (holding) or the next setup, then the checks, the backtest and notes.
  const rows = [
    ...(hold
      ? [row("Bought", sum.entryPrice === null ? "–" : fmt(sum.entryPrice)), row("Stop", sum.stop === null ? "–" : fmt(sum.stop), "neg"), row("P/L", pct(pnl, 2), pnl >= 0 ? "pos" : "neg")]
      : []),
    ...(sum.plan
      ? sum.plan.kind === "zone"
        ? [
            row("Next buy zone", `${fmt(sum.plan.low)}–${fmt(sum.plan.high)}`, sum.plan.inZone ? "pos" : ""),
            row(sum.plan.inZone ? "In zone" : "Distance", sum.plan.inZone ? tr("wait for MACD turn") : pct(sum.plan.distancePct)),
            row("Stop · Cost back", `${fmt(sum.plan.stop)} · ${sum.plan.target === null ? "–" : fmt(sum.plan.target)}`),
          ]
        : sum.plan.kind === "below"
          ? [
              row("Buy below", fmt(sum.plan.high), sum.plan.inZone ? "pos" : ""),
              row(sum.plan.inZone ? "Below now" : "Distance", sum.plan.inZone ? tr("wait for MACD turn") : pct(sum.plan.distancePct)),
              row("Stop · Cost back", `${fmt(sum.plan.stop)} · ${sum.plan.target === null ? "–" : fmt(sum.plan.target)}`),
            ]
          : [row("Buy above", `${fmt(sum.plan.high)} (${pct(sum.plan.distancePct)})`), row("Stop", fmt(sum.plan.stop))]
      : []),
    `<div class="lbl">${L(`Buy checks · ${ok} of ${sum.conditions.length}`, `เงื่อนไขซื้อ · ผ่าน ${ok} จาก ${sum.conditions.length}`)}</div>`,
    ...sum.conditions.map(
      (c, k) =>
        `<div class="c"><i class="${c.ok ? "ok" : ""}" aria-label="${c.ok ? L("passed", "ผ่าน") : L("not yet", "ยังไม่ผ่าน")}">${c.ok ? "✓" : ""}</i>` +
        `<span>${tr(shortLabels[k] ?? c.label)}</span><span class="${c.ok ? "ok" : "no"}" title="${c.detail}">${tr(c.detail.split(" vs ")[0]!)}</span></div>`,
    ),
    `<div class="lbl">${tr("Backtest")}</div>`,
    row(L(`${sum.stats.trades} trades`, `${sum.stats.trades} ไม้`), pct(sum.stats.returnPct), sum.stats.returnPct >= 0 ? "pos" : "neg"),
    ...(errorText ? [`<div class="msg neg sep">${tr(errorText)}</div>`] : []),
    ...(historyNote ? [`<div class="msg sep">${tr(historyNote)}</div>`] : []),
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
  // Sent every time: the chart object is replaced on symbol / timeframe changes. With no result
  // yet (loading, re-analysing, too few bars) leave the studies alone: an empty list removes
  // RSI / MACD, and re-adding them later loses the user's pane heights.
  if (!settings.showIndicators) postToFrames({ source: CONTENT_TAG, type: "studies", studies: [] });
  else if (last) postToFrames({ source: CONTENT_TAG, type: "studies", studies: last.setup.studies });
  if (!settings.drawMarkers || !last) {
    postToFrames({ source: CONTENT_TAG, type: "clear" });
    return;
  }
  const { candles, result } = last;
  const sec = (ms: number) => Math.floor(ms / 1000);
  // Fallback placement (inject.ts re-places them on the chart's own bars): buy under, sell over
  // the bar and its 2 neighbours each side, by the typical bar range there.
  const indexOf = new Map(candles.map((c, k) => [c.time, k]));
  const around = (t: number) => {
    const k = indexOf.get(t)!;
    const near = candles.slice(Math.max(0, k - 2), k + 3);
    const ranges = candles.slice(Math.max(0, k - 10), k + 11).map((c) => c.high - c.low).sort((x, y) => x - y);
    const pad = Math.max(ranges[Math.floor(ranges.length / 2)] ?? 0, candles[k]!.close * 0.003);
    return { low: Math.min(...near.map((c) => c.low)) - pad, high: Math.max(...near.map((c) => c.high)) + pad };
  };
  const below = (t: number) => around(t).low;
  const above = (t: number) => around(t).high;
  const trades = result.trades.slice(-MAX_DRAWN_TRADES);
  const payload: DrawPayload = {
    // Sharp swing-low entries: how far price fell into the signal bar (the bar before the BUY,
    // which sits on the fill bar). Above the candles, clear of the arrow.
    labels: last.setup.shortLabels.includes("Drop + vol peak")
      ? trades.flatMap((tr) => {
          // Drop + Volume: the drop bar is two bars before the BUY (then the bar that held its low).
          const k = indexOf.get(tr.entryTime);
          if (k === undefined || k < 23) return [];
          const j = k - 2;
          let sum = 0;
          for (let q = j - 20; q < j; q++) sum += candles[q]!.volumeUsd;
          const drop = (candles[j]!.close / candles[j - 1]!.close - 1) * 100;
          return [{ time: sec(candles[j]!.time), price: above(candles[j]!.time), text: `DROP ${drop.toFixed(1)}% · VOL ${sum > 0 ? (candles[j]!.volumeUsd / (sum / 20)).toFixed(1) : "–"}x`, color: "#b4b4b4" }];
        })
      : last.setup.shortLabels[0]!.startsWith("Fell ")
      ? trades.flatMap((tr) => {
          const k = indexOf.get(tr.entryTime);
          if (k === undefined || k < 8) return [];
          const j = k - 1;
          let hi = 0;
          for (let q = j - 6; q < j; q++) hi = Math.max(hi, candles[q]!.high);
          return [{ time: sec(candles[j]!.time), price: above(candles[j]!.time), text: `FELL ${((hi / candles[j]!.low - 1) * 100).toFixed(0)}%`, color: "#b4b4b4" }];
        })
      : [],
    arrows: trades.flatMap((tr) => [
      { time: sec(tr.entryTime), price: below(tr.entryTime), side: "buy" as const, text: "BUY", color: "#2196f3" },
      ...(tr.costBackTime !== undefined && !tr.partials
        ? [{ time: sec(tr.costBackTime), price: above(tr.costBackTime), side: "sell" as const, text: "COST BACK", color: "#fbbf24" }]
        : []),
      // Partial sells (10% signal exits): one marker per 10% sold.
      ...(tr.partials ?? []).map((ps) => ({
        time: sec(ps.time),
        price: above(ps.time),
        side: "sell" as const,
        text: `${last?.setup.sellLabel ?? "SELL 10%"} ${pct((ps.price / tr.entryPrice - 1) * 100)}`,
        color: "#fbbf24",
      })),
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
    plan: (() => {
      const pl = currentPlan();
      if (!pl) return null;
      const barSec = last.source.resolution * 60;
      const from = sec(candles.at(-1)!.time);
      return { kind: pl.kind, low: pl.low, high: pl.high, stop: pl.stop, target: pl.target, from, to: from + barSec * 40 };
    })(),
    levels: (last.setup.strategy.prepare(candles).levels?.(candles.length - 1) ?? []).map((l) => ({
      kind: l.kind,
      price: l.price,
      touches: l.touches,
      time: sec(candles[l.from]!.time),
    })),
    anchors: candles.slice(-300).map((c) => ({ time: sec(c.time), close: c.close })),
    stop: !settings.showStop ? null : result.trades.at(-1)?.reason === "end" ? (result.stops.at(-1) ?? null) : null,
    rangeLow: last.setup.strategy.prepare(candles).rangeLow?.(candles.length - 1) ?? null,
    sellLabel: last.setup.sellLabel ?? "SELL 10%",
    sellLimit: (() => {
      // The engine's own position after the last bar, so the alert uses the same stop and highest close as the backtest.
  const pos = result.openPosition;
      return pos ? (last.setup.strategy.prepare(candles).limitSell?.(candles.length - 1, pos)?.price ?? null) : null;
    })(),
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
  const label = `${source.chain} ${resLabel(source.resolution)} · ${pairName()}`;
  if (!inPos && strat.shouldEnter(candles.length - 1)) {
    once("buy", `EA BUY · ${last.setup.name}`, `${label}\nClose ${fmt(lastBar.close)} — buy at next bar open`);
  }
  const plan = currentPlan();
  if (plan?.inZone) {
    once("zone", `EA · price in buy zone · ${last.setup.name}`, `${label}\n${plan.kind === "below" ? `under ${fmt(plan.high)}` : `${fmt(plan.low)}–${fmt(plan.high)}`} — ${plan.waitFor}`);
  }
  // 10% signal sells keep the position open, so they never show up as an exit.
  // The engine's own position after the last bar, so the alert uses the same stop and highest close as the backtest.
  const pos = result.openPosition;
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
let fetched: { source: BarsSource; bars: Bar[]; complete: boolean } | null = null;
let chartBarsAt = 0;
/** Shown in the table when the history doesn't reach where the calculation should start. */
let historyNote: string | null = null;
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
    return `${setup.name} needs about ${Math.ceil(needDays)} days of history; the chart has ${ageDays.toFixed(1)} days loaded. Press Recalculate in the extension popup, or the pair may be too new.`;
  }
  return `Not enough bars on ${resLabel(resolution)} for ${setup.name}. Press Recalculate in the extension popup to load more.`;
}

function analyze(source: BarsSource, all: Candle[]): void {
  // An empty export just means the chart is still loading.
  if (all.length === 0) return;
  lastInput = { source, candles: all };
  const setup = setupStrategy(settings.strategy, source.resolution);
  const barMs = source.resolution * 60_000;
  // Drop the still-forming bar: signals are only valid on closed bars. Start from a fixed point
  // (midnight UTC, ~31 days plus warm-up back): trades are path dependent, so starting wherever
  // the chart's loaded history happens to begin made signals jump when the user scrolled back.
  // Bars older than that are ignored even when the user scrolls back to them.
  // "Pair start" begins at the pair's first bar, which is just as fixed once Recalculate has
  // loaded the history down to it (until then it begins at the first bar we have).
  const dayMs = 86_400_000;
  const start =
    settings.calcFrom === "start"
      ? all[0]!.time
      : Math.floor(Date.now() / dayMs) * dayMs - (Math.ceil((31 * 1440) / source.resolution) + 250) * barMs;
  const candles = all.filter((c) => c.time >= start && c.time + barMs <= Date.now());
  const feed = fetched?.source.resolution === source.resolution ? fetched : null;
  historyNote =
    settings.calcFrom === "start" && !feed?.complete
      ? "Not from the pair's start yet: press Recalculate in the extension popup."
      : settings.calcFrom === "31d" && candles.length && candles[0]!.time > start + 250 * barMs
        ? "Less than 31 days loaded: press Recalculate in the extension popup."
        : null;
  const sameChart =
    last &&
    last.source.pairId === source.pairId &&
    last.source.resolution === source.resolution &&
    last.source.marketCap === source.marketCap &&
    last.setup.id === setup.id;
  // Small incremental responses would replace the full history; keep what we have.
  if (sameChart && candles.length < last!.candles.length / 2) return;
  if (candles.length < setup.minBars) {
    errorText = notEnoughBars(setup, source.resolution, candles);
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

function onBars(source: BarsSource, bars: Bar[], complete: boolean): void {
  fetched = { source, bars, complete };
  if (!bars.length) return;
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
  if (msg.type === "bars") onBars(msg.source, msg.bars, msg.complete);
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
  setLang(settings.lang);
  translatePage(root);
  positionTable();
  paintCollapsed();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const prev = settings;
  settings = { ...settings, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])) } as Settings;
  positionTable();
  if (prev.lang !== settings.lang) {
    setLang(settings.lang);
    translatePage(root);
    paintCollapsed();
    renderTable();
  }
  if (prev.tableCollapsed !== settings.tableCollapsed) {
    paintCollapsed();
    renderTable();
  }
  if ((prev.strategy !== settings.strategy || prev.calcFrom !== settings.calcFrom) && lastInput) {
    last = null;
    analyze(lastInput.source, lastInput.candles);
  } else if (prev.drawMarkers !== settings.drawMarkers || prev.showStop !== settings.showStop || prev.showIndicators !== settings.showIndicators) drawOnTradingView();
});

// Picks up the stored history once; new pairs / timeframes arrive from the background script.
send({ type: "refresh" });
