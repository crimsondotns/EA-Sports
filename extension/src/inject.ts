// Runs in the page's MAIN world, in every frame. Looks for the TradingView charting library
// API in its own window and, if found, draws the ATH lines, Fib retracement and Anchored VWAP
// the content script sends.
import { CONTENT_TAG, MAIN_TAG, type DrawPayload, type FromContent, type FromMain } from "./messages.ts";

// Minimal slice of the TradingView charting library API that we use.
interface TvChart {
  createShape(point: { time: number; price?: number }, opts: object): Promise<unknown> | unknown;
  createMultipointShape(points: { time: number; price: number }[], opts: object): Promise<unknown> | unknown;
  getAllShapes?(): { id: unknown; name: string }[];
  getShapeById?(id: unknown): { getPoints(): { time: number; price: number }[]; setProperties?(props: object): void };
  exportData?(opts: object): Promise<{ schema: ExportField[]; data: ArrayLike<number>[] }>;
  onIntervalChanged?(): { subscribe(ctx: null, cb: () => void): void };
  onSymbolChanged?(): { subscribe(ctx: null, cb: () => void): void };
}

const LOOKUP_MS = 1000;
const CHART_PRICE_MS = 15_000;
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
function postStatus(ready: boolean, detail: string): void {
  const msg: FromMain = { source: MAIN_TAG, type: "status", ready, detail };
  window.top?.postMessage(msg, "*");
}

/** The chart object is replaced when the symbol or resolution changes, so look it up fresh. */
function currentChart(): TvChart | null {
  return findChart()?.chart ?? found?.chart ?? null;
}

const SHAPE_TIMEOUT_MS = 3000;

function postDrawResult(errors: string[]): void {
  const msg: FromMain = { source: MAIN_TAG, type: "drawResult", failed: errors.length, error: errors[0] ?? null };
  window.top?.postMessage(msg, "*");
}

interface ExportField {
  type: string;
  sourceType?: string;
  sourceTitle?: string;
  plotTitle?: string;
}

/** Close of the chart's last bar, as the chart shows it (USD or quote, price or market cap). */
async function lastClose(chart: TvChart): Promise<number | null> {
  try {
    const res = await chart.exportData?.({ includeTime: true, includeSeries: true, includedStudies: [] });
    if (!res) return null;
    const c = res.schema.findIndex((f) => f.sourceType !== "study" && f.plotTitle?.toLowerCase() === "close");
    const row = c < 0 ? undefined : Array.from(res.data).reverse().find((r) => Number.isFinite(r[c]));
    return row ? row[c]! : null;
  } catch (e) {
    console.debug("[EA] exportData failed", e);
    return null;
  }
}

async function postChartPrice(): Promise<void> {
  const chart = currentChart();
  if (!chart) return;
  const close = await lastClose(chart);
  if (close === null) return;
  const msg: FromMain = { source: MAIN_TAG, type: "chartPrice", close };
  window.top?.postMessage(msg, "*");
}

// ---------- drawings ----------

// ATH −90% / −95% are real drawings: saved with the chart layout, editable, never cleared by a
// redraw. Before adding one, look for a horizontal line already within 0.5% of its price (ours
// from an earlier run, or the user's own) and leave it as it is.
// Solid red line with a white label.
const ATH_STYLE = { linecolor: "#ef5350", linestyle: 0, linewidth: 1, showLabel: true, textcolor: "#ffffff" };

async function drawAthLines(chart: TvChart, ath: NonNullable<DrawPayload["ath"]>, errors: string[]): Promise<void> {
  const existing: number[] = [];
  for (const s of chart.getAllShapes?.() ?? []) {
    if (s.name !== "horizontal_line") continue;
    try {
      const price = chart.getShapeById?.(s.id).getPoints()[0]?.price;
      if (price !== undefined) existing.push(price);
    } catch {
      // Shape removed meanwhile.
    }
  }
  for (const l of ath.levels) {
    if (existing.some((x) => Math.abs(x / l.price - 1) < 0.005)) continue;
    const text = `ATH −${Math.round(l.pct * 100)}%`;
    try {
      const id = await Promise.race([
        Promise.resolve().then(() =>
          chart.createShape({ time: ath.time, price: l.price }, { shape: "horizontal_line", text, overrides: ATH_STYLE }),
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), SHAPE_TIMEOUT_MS)),
      ]);
      // Some library versions ignore overrides on create and use the tool's saved default (red).
      if (id !== null && id !== undefined) chart.getShapeById?.(id).setProperties?.(ATH_STYLE);
      existing.push(l.price);
    } catch (e) {
      errors.push(`${text}: ${(e as Error)?.message ?? e}`);
    }
  }
}

// Fib retracement from the ATL open to the ATH close, also a real saved drawing. Skipped when a
// Fib retracement already has both ends within 0.5% of those prices.
async function drawFib(chart: TvChart, atl: NonNullable<DrawPayload["atl"]>, ath: NonNullable<DrawPayload["ath"]>, errors: string[]): Promise<void> {
  const near = (a: number, b: number) => Math.abs(a / b - 1) < 0.005;
  for (const s of chart.getAllShapes?.() ?? []) {
    if (s.name !== "fib_retracement") continue;
    try {
      const [a, b] = chart.getShapeById?.(s.id).getPoints() ?? [];
      if (a && b && near(a.price, atl.open) && near(b.price, ath.close)) return;
    } catch {
      // Shape removed meanwhile.
    }
  }
  try {
    await Promise.race([
      Promise.resolve().then(() =>
        chart.createMultipointShape(
          [
            { time: atl.time, price: atl.open },
            { time: ath.time, price: ath.close },
          ],
          { shape: "fib_retracement" },
        ),
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), SHAPE_TIMEOUT_MS)),
    ]);
  } catch (e) {
    errors.push(`fib retracement: ${(e as Error)?.message ?? e}`);
  }
}

// Anchored VWAP from the pair's first bar, a real saved drawing. Skipped when the chart already
// has an Anchored VWAP (ours from an earlier run, or the user's own).
async function drawVwap(chart: TvChart, time: number, errors: string[]): Promise<void> {
  if ((chart.getAllShapes?.() ?? []).some((s) => s.name === "anchored_vwap")) return;
  try {
    await Promise.race([
      Promise.resolve().then(() => chart.createShape({ time }, { shape: "anchored_vwap" })),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), SHAPE_TIMEOUT_MS)),
    ]);
  } catch (e) {
    errors.push(`anchored vwap: ${(e as Error)?.message ?? e}`);
  }
}

async function draw(p: DrawPayload): Promise<void> {
  const chart = currentChart();
  if (!chart) {
    console.debug("[EA] draw skipped: no chart in this frame");
    return;
  }
  const errors: string[] = [];
  if (p.ath) await drawAthLines(chart, p.ath, errors);
  if (p.ath && p.atl) await drawFib(chart, p.atl, p.ath, errors);
  if (p.firstBar !== null) await drawVwap(chart, p.firstBar, errors);
  if (errors.length) console.warn("[EA] drawing errors", errors);
  postDrawResult(errors);
}

// Serialize draws: a new payload waits for the previous drawing pass to finish.
let queue = Promise.resolve();
function onMessage(e: MessageEvent<FromContent>): void {
  if (e.data?.source !== CONTENT_TAG) return;
  const msg = e.data;
  console.debug("[EA] inject got", msg.type, "in", window === window.top ? "top" : location.href, "chart found:", !!found);
  queue = queue
    .then(() => (msg.type === "draw" ? draw(msg.payload) : undefined))
    .catch(() => {});
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
      found.chart.onSymbolChanged?.().subscribe(null, () => setTimeout(() => void postChartPrice(), 2000));
      found.chart.onIntervalChanged?.().subscribe(null, () => setTimeout(() => void postChartPrice(), 2000));
    } catch {
      // optional
    }
    const where = window === window.top ? "top page" : `iframe${window.frameElement?.id ? ` #${window.frameElement.id}` : ""}`;
    postStatus(true, `TradingView API found via window.${found.via} in ${where}`);
    void postChartPrice();
    setInterval(() => void postChartPrice(), CHART_PRICE_MS);
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
