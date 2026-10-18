// Runs in the page's MAIN world, in every frame. Looks for the TradingView charting library
// API in its own window and, if found, draws the signals the content script sends.
// Indicators are left to the user's own DEX Screener chart setup.
import { CONTENT_TAG, MAIN_TAG, type ChartBar, type DrawPayload, type FromContent, type FromMain } from "./messages.ts";

// Minimal slice of the TradingView charting library API that we use.
interface TvChart {
  createShape(point: { time: number; price?: number }, opts: object): Promise<unknown> | unknown;
  createMultipointShape(points: { time: number; price: number }[], opts: object): Promise<unknown> | unknown;
  removeEntity(id: unknown): void;
  exportData?(opts: object): Promise<{ schema: ExportField[]; data: ArrayLike<number>[] }>;
  resolution?(): string;
  onIntervalChanged?(): { subscribe(ctx: null, cb: () => void): void };
  onSymbolChanged?(): { subscribe(ctx: null, cb: () => void): void };
}

const LOOKUP_MS = 1000;
const CHART_BARS_MS = 15_000;
const LOOKUP_TRIES = 90;

function findChart(): { chart: TvChart; via: string } | null {
  const w = window as unknown as Record<string, unknown>;
  const candidates: [string, unknown][] = [
    ["tradingViewApi", w.tradingViewApi],
    ["TradingViewApi", w.TradingViewApi],
    ["tvWidget", w.tvWidget],
    ["widget", w.widget],
  ];
  for (const [via, api] of candidates) {
    const a = api as { activeChart?: () => TvChart; chart?: () => TvChart } | undefined;
    try {
      const chart = a?.activeChart?.() ?? a?.chart?.();
      if (chart && typeof chart.createShape === "function") return { chart, via };
    } catch {
      // not ready yet
    }
  }
  return null;
}

let found: { chart: TvChart; via: string } | null = null;
const drawn: unknown[] = [];

function postStatus(ready: boolean, detail: string): void {
  const msg: FromMain = { source: MAIN_TAG, type: "status", ready, detail };
  window.top?.postMessage(msg, "*");
}

/** The chart object is replaced when the symbol or resolution changes, so look it up fresh. */
function currentChart(): TvChart | null {
  return findChart()?.chart ?? found?.chart ?? null;
}

function clear(): void {
  const chart = currentChart();
  for (const id of drawn.splice(0)) {
    try {
      chart?.removeEntity(id);
    } catch {
      // already gone (e.g. chart reloaded)
    }
  }
}

const SHAPE_TIMEOUT_MS = 3000;

function postProgress(text: string): void {
  const msg: FromMain = { source: MAIN_TAG, type: "drawResult", ok: 0, failed: 0, error: null, progress: text };
  window.top?.postMessage(msg, "*");
}

function postDrawResult(ok: number, failed: number, errors: string[], note?: string): void {
  const msg: FromMain = { source: MAIN_TAG, type: "drawResult", ok, failed, error: errors[0] ?? null, note };
  window.top?.postMessage(msg, "*");
}

interface ExportField {
  type: string;
  sourceType?: string;
  sourceTitle?: string;
  plotTitle?: string;
}

/** OHLC (+ volume if the chart has a Volume study) of every bar loaded in the chart. */
async function exportChartBars(chart: TvChart): Promise<{ bars: ChartBar[]; hasVolume: boolean } | null> {
  try {
    const opts = { includeTime: true, includeSeries: true };
    // "all" adds the Volume study's column; older versions only accept a list of study ids.
    const res = await chart.exportData?.({ ...opts, includedStudies: "all" }).catch(() => chart.exportData?.({ ...opts, includedStudies: [] }));
    if (!res) return null;
    const idx = (pred: (f: ExportField) => boolean) => res.schema.findIndex(pred);
    const series = (name: string) => idx((f) => f.sourceType !== "study" && f.plotTitle?.toLowerCase() === name);
    const t = idx((f) => f.type === "time");
    const [o, h, l, c] = [series("open"), series("high"), series("low"), series("close")];
    const v = idx((f) => f.sourceType === "study" && /volume/i.test(f.sourceTitle ?? "") && /^vol/i.test(f.plotTitle ?? ""));
    if ([t, o, h, l, c].some((i) => i < 0)) return null;
    const bars = Array.from(res.data, (row) => ({
      time: row[t]! > 1e12 ? Math.floor(row[t]! / 1000) : row[t]!,
      open: row[o]!,
      high: row[h]!,
      low: row[l]!,
      close: row[c]!,
      volume: v >= 0 && Number.isFinite(row[v]) ? row[v]! : null,
    })).filter((b) => Number.isFinite(b.close));
    return { bars, hasVolume: v >= 0 };
  } catch (e) {
    console.debug("[EA] exportData failed", e);
    return null;
  }
}

async function postChartBars(): Promise<void> {
  const chart = currentChart();
  if (!chart) return;
  const r = await exportChartBars(chart);
  if (!r) return;
  const msg: FromMain = { source: MAIN_TAG, type: "chartBars", resolution: chart.resolution?.() ?? "", ...r };
  window.top?.postMessage(msg, "*");
}

interface TvBar {
  time: number;
  high: number;
  low: number;
  close: number;
}

/** The chart's own bars, as the charting library holds them. */
async function chartBars(chart: TvChart): Promise<TvBar[] | null> {
  try {
    const res = await chart.exportData?.({ includeTime: true, includeSeries: true, includedStudies: [] });
    if (!res) return null;
    const col = (name: string, fallback: number) => {
      const i = res.schema.findIndex((s) => s.plotTitle?.toLowerCase() === name);
      return i >= 0 ? i : fallback;
    };
    const [t, h, l, c] = [res.schema.findIndex((s) => s.type === "time"), col("high", 2), col("low", 3), col("close", 4)];
    return Array.from(res.data, (row) => ({
      time: row[t < 0 ? 0 : t]! > 1e12 ? Math.floor(row[t < 0 ? 0 : t]! / 1000) : row[t < 0 ? 0 : t]!,
      high: row[h]!,
      low: row[l]!,
      close: row[c]!,
    }));
  } catch {
    return null;
  }
}

/** Most common (chart time - our time) among bars whose closes match. */
function timeOffset(anchors: DrawPayload["anchors"], bars: TvBar[]): number | null {
  const byClose = new Map<string, number[]>();
  const key = (v: number) => v.toPrecision(6);
  for (const b of bars) byClose.set(key(b.close), [...(byClose.get(key(b.close)) ?? []), b.time]);
  const votes = new Map<number, number>();
  for (const a of anchors) for (const t of byClose.get(key(a.close)) ?? []) votes.set(t - a.time, (votes.get(t - a.time) ?? 0) + 1);
  let best: [number, number] | null = null;
  for (const v of votes) if (!best || v[1] > best[1]) best = v;
  return best && best[1] >= 3 ? best[0] : null;
}

async function draw(p: DrawPayload): Promise<void> {
  const chart = currentChart();
  if (!chart) {
    console.debug("[EA] draw skipped: no chart in this frame");
    return;
  }
  clear();
  postProgress(`drawing ${p.arrows.length} arrows…`);
  let ok = 0;
  const errors: string[] = [];
  const add = async (what: string, make: () => Promise<unknown> | unknown) => {
    try {
      // Some library versions never settle the promise for an invalid shape; don't hang the queue.
      const id = await Promise.race([
        Promise.resolve().then(make),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), SHAPE_TIMEOUT_MS)),
      ]);
      if (id === null || id === undefined) throw new Error("returned no id");
      drawn.push(id);
      ok++;
    } catch (e) {
      errors.push(`${what}: ${(e as Error)?.message ?? e}`);
    }
  };
  const opts = { lock: true, disableSelection: true, disableSave: true, disableUndo: true };

  for (const s of p.segments) {
    await add("trend_line", () =>
      chart.createMultipointShape([s.from, s.to], { ...opts, shape: "trend_line", overrides: { linecolor: s.color, linewidth: 2, linestyle: 2 } }),
    );
  }
  // Place markers on the chart's own bars: line our times up with them and use their high/low,
  // so markers sit next to the candles even if the chart's timestamps or values differ from ours.
  const bars = await chartBars(chart);
  const offset = bars ? timeOffset(p.anchors, bars) : null;
  const barAt = new Map((bars ?? []).map((b) => [b.time, b]));
  const place = (a: DrawPayload["arrows"][number]) => {
    const b = offset === null ? undefined : barAt.get(a.time + offset);
    if (!b) return { time: a.time, price: a.price };
    const pad = (b.high - b.low) * 0.4 || b.close * 0.002;
    return { time: b.time, price: a.side === "buy" ? b.low - pad : b.high + pad };
  };
  const note = bars === null ? "chart bars unavailable" : offset === null ? "couldn't match chart bars" : offset ? `time offset ${offset / 3600}h` : "aligned";
  console.debug("[EA] chart bars", bars?.length, "offset", offset);

  for (const a of p.arrows) {
    await add(a.side === "buy" ? "arrow_up" : "arrow_down", () =>
      chart.createShape(
        place(a),
        { ...opts, shape: a.side === "buy" ? "arrow_up" : "arrow_down", text: a.text, overrides: { color: a.color, arrowColor: a.color, fontsize: 12 } },
      ),
    );
  }
  if (p.plan) {
    const pl = p.plan;
    if (pl.kind === "zone") {
      await add("rectangle", () =>
        chart.createMultipointShape(
          [
            { time: pl.from, price: pl.high },
            { time: pl.to, price: pl.low },
          ],
          {
            ...opts,
            shape: "rectangle",
            text: "NEXT BUY ZONE",
            overrides: { color: "#4ade80", linewidth: 1, fillBackground: true, backgroundColor: "rgba(74, 222, 128, 0.14)", showLabel: true, textColor: "#4ade80" },
          },
        ),
      );
    } else {
      await add("trigger", () =>
        chart.createMultipointShape(
          [
            { time: pl.from, price: pl.high },
            { time: pl.to, price: pl.high },
          ],
          { ...opts, shape: "trend_line", text: "BUY ABOVE", overrides: { linecolor: "#2196f3", linewidth: 2, linestyle: 0, showLabel: true, textcolor: "#2196f3" } },
        ),
      );
    }
    const line = (price: number, text: string, color: string) =>
      add(text, () =>
        chart.createMultipointShape(
          [
            { time: pl.from, price },
            { time: pl.to, price },
          ],
          { ...opts, shape: "trend_line", text, overrides: { linecolor: color, linewidth: 1, linestyle: 2, showLabel: true, textcolor: color } },
        ),
      );
    await line(pl.stop, "PLAN STOP", "#f87171");
    if (pl.target !== null) await line(pl.target, "COST BACK 3x", "#fbbf24");
  }
  for (const l of p.levels ?? []) {
    const color = l.kind === "support" ? "#4ade80" : "#f87171";
    await add("horizontal_ray", () =>
      chart.createShape(
        { time: l.time, price: l.price },
        {
          ...opts,
          shape: "horizontal_ray",
          text: `${l.kind === "support" ? "S" : "R"} ×${l.touches}`,
          overrides: { linecolor: color, linewidth: 1, linestyle: 2, showLabel: true, textcolor: color, horzLabelsAlign: "right" },
        },
      ),
    );
  }
  if (p.stop !== null) {
    const last = p.arrows.at(-1)?.time ?? Math.floor(Date.now() / 1000);
    await add("horizontal_line", () =>
      chart.createShape(
        { time: last, price: p.stop! },
        { ...opts, shape: "horizontal_line", text: "EA STOP", overrides: { linecolor: "#ef5350", linestyle: 1, showLabel: true, textcolor: "#ef5350" } },
      ),
    );
  }
  if (errors.length) console.warn("[EA] drawing errors", errors);
  postDrawResult(ok, errors.length, errors, note);
}

// Serialize draws: a new payload waits for the previous drawing pass to finish.
let queue = Promise.resolve();
function onMessage(e: MessageEvent<FromContent>): void {
  if (e.data?.source !== CONTENT_TAG) return;
  const msg = e.data;
  console.debug("[EA] inject got", msg.type, "in", window === window.top ? "top" : location.href, "chart found:", !!found);
  queue = queue.then(() => (msg.type === "draw" ? draw(msg.payload) : clear())).catch(() => {});
}

// TradingView fills its iframe with document.open()/write(), which removes listeners added
// before that. Re-adding the same function is a no-op, so keep re-attaching it.
const listen = () => window.addEventListener("message", onMessage);
listen();
setInterval(listen, 1000);

let tries = 0;
const timer = setInterval(() => {
  found = findChart();
  if (found) {
    clearInterval(timer);
    listen();
    try {
      // Price/Mcap toggle and pair changes swap the symbol; redraw at the new scale.
      found.chart.onSymbolChanged?.().subscribe(null, () => setTimeout(() => void postChartBars(), 2000));
      found.chart.onIntervalChanged?.().subscribe(null, () => setTimeout(() => void postChartBars(), 2000));
    } catch {
      // optional
    }
    const where = window === window.top ? "top page" : `iframe${window.frameElement?.id ? ` #${window.frameElement.id}` : ""}`;
    postStatus(true, `TradingView API found via window.${found.via} in ${where}`);
    void postChartBars();
    setInterval(() => void postChartBars(), CHART_BARS_MS);
  } else if (++tries >= LOOKUP_TRIES) {
    clearInterval(timer);
    // Only the top frame reports failure, so a found chart in an iframe isn't overridden.
    if (window === window.top) postStatus(false, "TradingView API not reachable from the page");
  }
}, LOOKUP_MS);

// ---------- capture the chart's bars requests from inside the page ----------
// Fallback for when chrome.webRequest doesn't see them (e.g. requests made by a worker).

const BARS_RE = /^https:\/\/(?:io|feed)\.dexscreener\.com\/dex\/chart\/amm\/v\d+\/[^/]+\/bars\//;
const CHANNEL = "ea-bars-url";

function reportBarsUrl(url: string): void {
  if (!BARS_RE.test(url)) return;
  const msg: FromMain = { source: MAIN_TAG, type: "barsUrl", url };
  window.top?.postMessage(msg, "*");
}

const origFetch = window.fetch;
window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
  try {
    reportBarsUrl(input instanceof Request ? input.url : String(input));
  } catch {
    // never break the page
  }
  return origFetch.call(this, input, init);
};

const origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  try {
    reportBarsUrl(String(url));
  } catch {
    // never break the page
  }
  return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
} as typeof XMLHttpRequest.prototype.open;

// Workers have their own fetch: wrap them so they report bars URLs over a BroadcastChannel.
new BroadcastChannel(CHANNEL).onmessage = (e: MessageEvent<string>) => reportBarsUrl(e.data);

const WORKER_PRELUDE = `(() => {
  const ch = new BroadcastChannel(${JSON.stringify(CHANNEL)});
  const re = ${BARS_RE.toString()};
  const f = self.fetch;
  self.fetch = function (input, init) {
    try { const u = input instanceof Request ? input.url : String(input); if (re.test(u)) ch.postMessage(u); } catch {}
    return f.call(this, input, init);
  };
  const o = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u, ...r) {
    try { if (re.test(String(u))) ch.postMessage(String(u)); } catch {}
    return o.call(this, m, u, ...r);
  };
})();`;

const OrigWorker = window.Worker;
window.Worker = function (this: Worker, scriptURL: string | URL, options?: WorkerOptions) {
  try {
    const abs = new URL(String(scriptURL), location.href).href;
    const body =
      options?.type === "module"
        ? `${WORKER_PRELUDE}\nimport ${JSON.stringify(abs)};`
        : `${WORKER_PRELUDE}\nimportScripts(${JSON.stringify(abs)});`;
    const blobUrl = URL.createObjectURL(new Blob([body], { type: "text/javascript" }));
    return new OrigWorker(blobUrl, options);
  } catch {
    return new OrigWorker(scriptURL, options);
  }
} as unknown as typeof Worker;
window.Worker.prototype = OrigWorker.prototype;

// Requests made before this script ran (or by the page itself) are in the resource timeline.
const scanTimeline = () => {
  for (const e of performance.getEntriesByType("resource")) reportBarsUrl(e.name);
};
new PerformanceObserver((list) => list.getEntries().forEach((e) => reportBarsUrl(e.name))).observe({ type: "resource", buffered: true });
setTimeout(scanTimeline, 3000);
