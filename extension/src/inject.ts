// Runs in the page's MAIN world, in every frame. Looks for the TradingView charting library
// API in its own window and, if found, draws the signals the content script sends.
// It also adds the active strategy's indicators (built-in TradingView studies).
import { CONTENT_TAG, MAIN_TAG, type ChartBar, type DrawPayload, type FromContent, type FromMain, type StudySpec } from "./messages.ts";

// Minimal slice of the TradingView charting library API that we use.
interface TvChart {
  createShape(point: { time: number; price?: number }, opts: object): Promise<unknown> | unknown;
  createMultipointShape(points: { time: number; price: number }[], opts: object): Promise<unknown> | unknown;
  removeEntity(id: unknown): void;
  getShapeById?(id: unknown): { getPoints?(): { time: number; price: number }[]; isSavingEnabled?(): boolean };
  createStudy?(name: string, forceOverlay: boolean, lock?: boolean): Promise<unknown> | unknown;
  getAllStudies?(): { id: unknown; name: string }[];
  getStudyById?(id: unknown): TvStudy;
  getPanes?(): TvPane[];
  exportData?(opts: object): Promise<{ schema: ExportField[]; data: ArrayLike<number>[] }>;
  resolution?(): string;
  onIntervalChanged?(): { subscribe(ctx: null, cb: () => void): void };
  onSymbolChanged?(): { subscribe(ctx: null, cb: () => void): void };
}

interface TvPane {
  getHeight?(): number;
  setHeight?(height: number): void;
  getStudies?(): { id: unknown }[];
  hasMainSeries?(): boolean;
}

interface TvStudy {
  getInputsInfo(): { id: string; name: string }[];
  getInputValues(): { id: string; value: unknown }[];
  setInputValues(values: { id: string; value: unknown }[]): void;
  applyOverrides?(overrides: object): void;
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
/** Our shapes, with the points they were drawn at. Ids are only unique per chart: after a symbol /
 *  timeframe change or a chart reload an old id can belong to one of the user's drawings, so a
 *  shape is removed only if it still sits exactly where we drew it.
 *  The list lives on the top window, shared by every copy of this script: one runs in the page and
 *  one in the chart iframe (re-run each time TradingView rewrites it), and a copy that drew shapes
 *  and later lost the chart never cleared them, so an old STOP line stayed next to the new one. */
type Drawn = { id: unknown; points: string }[];
const drawn: Drawn = (() => {
  try {
    const top = window.top as Window & { __eaDrawn?: Drawn };
    return (top.__eaDrawn ??= []);
  } catch {
    return [];
  }
})();
const pointsOf = (chart: TvChart | null, id: unknown): string | null => {
  try {
    const pts = chart?.getShapeById?.(id)?.getPoints?.();
    return pts ? JSON.stringify(pts.map((p) => [p.time, p.price])) : null;
  } catch {
    return null;
  }
};

function postStatus(ready: boolean, detail: string): void {
  const msg: FromMain = { source: MAIN_TAG, type: "status", ready, detail };
  window.top?.postMessage(msg, "*");
}

/** The chart object is replaced when the symbol or resolution changes, so look it up fresh. */
function currentChart(): TvChart | null {
  return findChart()?.chart ?? found?.chart ?? null;
}

/** Ours = drawn with `disableSave` (the user's drawings are saved with the chart). Without that
 *  method, fall back to "still at the points we drew it at" (the time of a horizontal line can
 *  change, so only prices are compared). */
function ours(chart: TvChart | null, id: unknown, points: string): boolean {
  try {
    const shape = chart?.getShapeById?.(id);
    if (!shape) return false;
    const saving = shape.isSavingEnabled?.();
    if (saving !== undefined) return !saving;
  } catch {
    return false;
  }
  const prices = (s: string) => (JSON.parse(s || "[]") as number[][]).map((p) => p[1]).join();
  const now = pointsOf(chart, id);
  return now !== null && points !== "" && prices(now) === prices(points);
}

function clear(): void {
  const chart = currentChart();
  for (const { id, points } of drawn.splice(0)) {
    if (!ours(chart, id, points)) continue;
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

// ---------- strategy indicators ----------

// Study panes already sized this page load (kept on the top window, so a rewrite of the chart
// iframe doesn't size them again after the user dragged them).
const sizedOnce: Set<string> = (() => {
  try {
    const top = window.top as Window & { __eaSized?: Set<string> };
    return (top.__eaSized ??= new Set());
  } catch {
    return new Set();
  }
})();

// Studies this script added, keyed by spec, so a strategy switch removes only ours.
const ourStudies = new Map<string, unknown>();
const specKey = (s: StudySpec) => `${s.name}|${JSON.stringify(s.inputs ?? {})}`;

/** Input ids of `study` for each spec input, matched by name ("length" matches "Length"). */
function inputIds(study: TvStudy, spec: StudySpec): Map<string, string> {
  const info = study.getInputsInfo();
  const ids = new Map<string, string>();
  for (const k of Object.keys(spec.inputs ?? {})) {
    const hit = info.find((x) => x.name.toLowerCase() === k) ?? info.find((x) => x.name.toLowerCase().includes(k));
    if (hit) ids.set(k, hit.id);
  }
  return ids;
}

function matches(chart: TvChart, id: unknown, spec: StudySpec): boolean {
  try {
    const study = chart.getStudyById!(id);
    const values = new Map(study.getInputValues().map((v) => [v.id, v.value]));
    return [...inputIds(study, spec)].every(([k, inputId]) => Number(values.get(inputId)) === spec.inputs![k]);
  } catch {
    return false;
  }
}

async function applyStudies(specs: StudySpec[]): Promise<void> {
  const chart = currentChart();
  if (!chart?.createStudy || !chart.getAllStudies || !chart.getStudyById) return;
  const wanted = new Set(specs.map(specKey));
  for (const [key, id] of ourStudies) {
    if (wanted.has(key)) continue;
    try {
      chart.removeEntity(id);
    } catch {
      // already gone
    }
    ourStudies.delete(key);
  }
  // Never remove or re-create a study that is already on the chart: a re-created pane loses the
  // user's height, and this runs on every redraw (re-creating here once made RSI / MACD shrink
  // and snap back while being dragged). Only add what is missing, in spec order.
  const existing = chart.getAllStudies();
  const alive = new Set(existing.map((s) => String(s.id)));
  for (const spec of specs) {
    const key = specKey(spec);
    const ours = ourStudies.get(key);
    if (ours !== undefined && alive.has(String(ours))) continue;
    // Reuse a matching study: the user's own, DEX Screener's, or ours saved with the layout.
    const same = existing.find((s) => s.name.toLowerCase() === spec.name.toLowerCase() && matches(chart, s.id, spec));
    if (same) {
      ourStudies.delete(key); // not ours to remove later
      // The user asked for compact RSI / MACD: size its pane once per page (not on every redraw),
      // so dragging it afterwards sticks.
      if (!spec.overlay && !sizedOnce.has(String(same.id))) {
        sizedOnce.add(String(same.id));
        sizeNewPane(chart, same.id);
      }
      continue;
    }
    try {
      const id = await Promise.race([
        Promise.resolve(chart.createStudy(spec.name, !!spec.overlay, false)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), SHAPE_TIMEOUT_MS)),
      ]);
      if (id === null || id === undefined) continue;
      ourStudies.set(key, id);
      const study = chart.getStudyById(id);
      const ids = inputIds(study, spec);
      if (ids.size) study.setInputValues([...ids].map(([k, inputId]) => ({ id: inputId, value: spec.inputs![k] })));
      if (spec.color) study.applyOverrides?.({ "Plot.color": spec.color, "plot.color": spec.color });
      if (!spec.overlay) setTimeout(() => sizeNewPane(chart, id), 500);
    } catch (e) {
      console.warn("[EA] could not add study", spec.name, e);
    }
  }
}

/**
 * Once, right after the extension creates a study in a new pane: size that pane to ~12% of the
 * chart (at least 72px), so RSI / MACD stay compact instead of the library's default share (about
 * a quarter each). Panes that already exist, or that the user sized later, are never touched.
 */
function sizeNewPane(chart: TvChart, id: unknown): void {
  try {
    const panes = chart.getPanes?.() ?? [];
    // Find the study's pane; if this chart's pane API can't list studies, size every indicator pane
    // (all panes but the price pane: the strategy's RSI / MACD).
    const canList = panes.some((p) => typeof p.getStudies === "function");
    const targets = canList
      ? panes.filter((p, k) => k > 0 && p.getStudies!()?.some((s) => String(s.id) === String(id)))
      : panes.filter((p, k) => k > 0 && !p.hasMainSeries?.());
    const total = panes.reduce((a, p) => a + (p.getHeight?.() ?? 0), 0);
    const target = Math.max(72, Math.round(total * 0.12));
    console.info("[EA] pane sizing", { panes: panes.length, canList, targets: targets.length, total, target, heights: panes.map((p) => p.getHeight?.()) });
    for (const pane of targets) {
      if (!pane.getHeight || !pane.setHeight) {
        console.info("[EA] pane sizing not supported by this chart (no getHeight / setHeight)");
        return;
      }
      if (Math.abs(pane.getHeight() - target) > 8) pane.setHeight(target);
    }
  } catch (e) {
    console.info("[EA] could not size the pane", e);
  }
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
      drawn.push({ id, points: pointsOf(chart, id) ?? "" });
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
  const indexAt = new Map((bars ?? []).map((b, k) => [b.time, k]));
  // Buy arrows always under the candles, sell arrows always over them: the arrow's tip goes
  // below the lowest low (above the highest high) of the bar and its 2 neighbours each side, plus
  // a gap of the typical bar range there, so a small bar next to big ones isn't covered either.
  const place = (a: DrawPayload["arrows"][number]) => {
    const k = offset === null ? undefined : indexAt.get(a.time + offset);
    if (k === undefined || !bars) return { time: a.time, price: a.price };
    const near = bars.slice(Math.max(0, k - 2), k + 3);
    const ranges = bars.slice(Math.max(0, k - 10), k + 11).map((b) => b.high - b.low).sort((x, y) => x - y);
    const pad = Math.max(ranges[Math.floor(ranges.length / 2)] ?? 0, bars[k]!.close * 0.003);
    return a.side === "buy"
      ? { time: bars[k]!.time, price: Math.min(...near.map((b) => b.low)) - pad }
      : { time: bars[k]!.time, price: Math.max(...near.map((b) => b.high)) + pad };
  };
  const note = bars === null ? "chart bars unavailable" : offset === null ? "couldn't match chart bars" : offset ? `time offset ${offset / 3600}h` : "aligned";
  console.debug("[EA] chart bars", bars?.length, "offset", offset);

  for (const l of p.labels) {
    await add("label", () =>
      chart.createShape(place({ ...l, side: "sell" }), { ...opts, shape: "text", text: l.text, overrides: { color: l.color, fontsize: 10 } }),
    );
  }
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
          {
            ...opts,
            shape: "trend_line",
            text: pl.kind === "below" ? "BUY BELOW" : "BUY ABOVE",
            overrides: { linecolor: pl.kind === "below" ? "#4ade80" : "#2196f3", linewidth: 2, linestyle: 0, showLabel: true, textcolor: pl.kind === "below" ? "#4ade80" : "#2196f3" },
          },
        ),
      );
    }
    // horizontal_ray, like the S/R levels, so each price also gets a label on the price scale.
    const line = (price: number, text: string, color: string, style = 2) =>
      add(text, () =>
        chart.createShape(
          { time: pl.from, price },
          {
            ...opts,
            shape: "horizontal_ray",
            text,
            overrides: { linecolor: color, linewidth: 1, linestyle: style, showLabel: !!text, textcolor: color, horzLabelsAlign: "right" },
          },
        ),
      );
    // A rectangle has no price-scale label, so mark the zone edges too.
    if (pl.kind === "zone") {
      await line(pl.high, "", "#4ade80", 0);
      await line(pl.low, "", "#4ade80", 0);
    }
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
        { ...opts, shape: "horizontal_line", text: "STOP", overrides: { linecolor: "#ef5350", linestyle: 1, showLabel: true, textcolor: "#ef5350" } },
      ),
    );
  }
  if (p.rangeLow) {
    const last = Math.floor(Date.now() / 1000);
    const text = p.rangeLow.uptrend ? "RANGE LOW · uptrend" : "RANGE LOW · buy zone";
    await add("range low", () =>
      chart.createShape(
        { time: last, price: p.rangeLow!.price },
        { ...opts, shape: "horizontal_line", text, overrides: { linecolor: "#a855f7", linestyle: p.rangeLow!.uptrend ? 2 : 0, showLabel: true, textcolor: "#a855f7" } },
      ),
    );
  }
  if (p.sellLimit !== null) {
    const last = p.arrows.at(-1)?.time ?? Math.floor(Date.now() / 1000);
    await add("sell limit", () =>
      chart.createShape(
        { time: last, price: p.sellLimit! },
        { ...opts, shape: "horizontal_line", text: `${p.sellLabel} LIMIT`, overrides: { linecolor: "#fbbf24", linestyle: 2, showLabel: true, textcolor: "#fbbf24" } },
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
  queue = queue
    .then(() => (msg.type === "draw" ? draw(msg.payload) : msg.type === "studies" ? applyStudies(msg.studies) : clear()))
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
