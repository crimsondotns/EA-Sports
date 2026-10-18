import type { BacktestResult } from "../backtest/engine.ts";
import type { Candle } from "../indicators.ts";

export interface ReportInput {
  title: string;
  candles: Candle[];
  result: BacktestResult;
}

// Self-contained HTML chart using TradingView Lightweight Charts from a CDN.
export function renderReport({ title, candles, result }: ReportInput): string {
  const sec = (ms: number) => Math.floor(ms / 1000);
  const data = {
    candles: candles.map((c) => ({ time: sec(c.time), open: c.open, high: c.high, low: c.low, close: c.close })),
    volume: candles.map((c) => ({
      time: sec(c.time),
      value: c.volumeUsd,
      color: c.close >= c.open ? "rgba(38,166,154,.45)" : "rgba(239,83,80,.45)",
    })),
    indicators: result.indicators.map((ind) => ({
      ...ind,
      values: ind.values.map((v, i) => (Number.isFinite(v) ? { time: sec(candles[i]!.time), value: v } : { time: sec(candles[i]!.time) })),
    })),
    stops: result.stops.map((v, i) => (v === null ? { time: sec(candles[i]!.time) } : { time: sec(candles[i]!.time), value: v })),
    equity: result.equity.map((e) => ({ time: sec(e.time), value: e.value })),
    trades: result.trades.map((t) => ({ ...t, entryTime: sec(t.entryTime), exitTime: sec(t.exitTime) })),
    stats: result.stats,
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<script src="https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js"></script>
<style>
  :root { --bg:#0f1115; --panel:#161a21; --text:#d6dae1; --muted:#8a93a3; --up:#26a69a; --down:#ef5350; --line:#232833; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:13px/1.4 -apple-system, system-ui, sans-serif; }
  header { padding:12px 16px; display:flex; flex-wrap:wrap; gap:8px 20px; align-items:baseline; border-bottom:1px solid var(--line); }
  h1 { font-size:15px; margin:0; }
  .stat b { font-variant-numeric: tabular-nums; }
  .stat span { color:var(--muted); margin-right:4px; }
  #chart { height:62vh; }
  #equity { height:18vh; border-top:1px solid var(--line); }
  table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  th, td { padding:6px 10px; text-align:right; border-bottom:1px solid var(--line); white-space:nowrap; }
  th { color:var(--muted); font-weight:500; position:sticky; top:0; background:var(--bg); }
  th:first-child, td:first-child { text-align:left; }
  tbody tr { cursor:pointer; }
  tbody tr:hover { background:var(--panel); }
  .pos { color:var(--up); } .neg { color:var(--down); }
  .wrap { max-height:40vh; overflow:auto; }
  #legend { display:flex; flex-wrap:wrap; gap:4px 14px; padding:6px 16px; border-bottom:1px solid var(--line); }
  #legend label { display:flex; align-items:center; gap:6px; cursor:pointer; color:var(--muted); }
  #legend i { width:14px; height:3px; display:inline-block; border-radius:2px; }
</style>
</head>
<body>
<header id="stats"><h1>${escapeHtml(title)}</h1></header>
<div id="legend"></div>
<div id="chart"></div>
<div id="equity"></div>
<div class="wrap"><table>
  <thead><tr><th>#</th><th>Entry (UTC)</th><th>Exit (UTC)</th><th>Entry</th><th>Exit</th><th>Bars</th><th>Return</th><th>Reason</th></tr></thead>
  <tbody id="trades"></tbody>
</table></div>
<script>
const D = ${JSON.stringify(data)};
const fmtTime = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ");
const fmtPx = (p) => p.toPrecision(5);

const s = D.stats;
const statItems = [
  ["Trades", s.trades], ["Win", s.winRate.toFixed(1) + "%"], ["Return", s.totalReturnPct.toFixed(1) + "%"],
  ["Max DD", s.maxDrawdownPct.toFixed(1) + "%"], ["PF", s.profitFactor.toFixed(2)],
  ["Avg win", s.avgWinPct.toFixed(2) + "%"], ["Avg loss", s.avgLossPct.toFixed(2) + "%"],
];
if (s.freeQty > 0) statItems.push(["Cash", s.realizedCash.toFixed(0)], ["Free tokens value", s.freeValue.toFixed(0)]);
document.getElementById("stats").insertAdjacentHTML("beforeend",
  statItems.map(([k, v]) => '<div class="stat"><span>' + k + '</span><b>' + v + '</b></div>').join(""));

const minPx = Math.min(...D.candles.map((c) => c.low).filter((x) => x > 0));
const precision = Math.min(12, Math.max(2, Math.ceil(-Math.log10(minPx)) + 3));
const base = {
  layout: { background: { color: "#0f1115" }, textColor: "#d6dae1" },
  grid: { vertLines: { color: "#1b1f27" }, horzLines: { color: "#1b1f27" } },
  timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#232833" },
  rightPriceScale: { borderColor: "#232833" },
  crosshair: { mode: 0 },
};

const chartEl = document.getElementById("chart");
const chart = LightweightCharts.createChart(chartEl, base);
const candles = chart.addCandlestickSeries({
  upColor: "#26a69a", downColor: "#ef5350", borderVisible: false, wickUpColor: "#26a69a", wickDownColor: "#ef5350",
  priceFormat: { type: "price", precision, minMove: Math.pow(10, -precision) },
});
candles.setData(D.candles);

const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
vol.setData(D.volume);

const legend = [];
for (const ind of D.indicators) {
  const line = chart.addLineSeries({
    color: ind.color, lineWidth: ind.pane === "volume" ? 1 : 2, lineStyle: ind.dashed ? 2 : 0,
    priceScaleId: ind.pane === "volume" ? "vol" : "right",
    priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    ...(ind.pane === "volume" ? { priceFormat: { type: "volume" } } : {}),
  });
  line.setData(ind.values);
  legend.push({ name: ind.name, color: ind.color, series: [line] });
}
const stopLine = chart.addLineSeries({
  color: "#ef5350", lineWidth: 1, lineType: 1, lineStyle: 1,
  priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
});
stopLine.setData(D.stops);
legend.push({ name: "Stop / trailing stop", color: "#ef5350", series: [stopLine] });

const markers = [];
for (const [i, t] of D.trades.entries()) {
  markers.push({ time: t.entryTime, position: "belowBar", color: "#2196f3", shape: "arrowUp", text: "BUY #" + (i + 1) });
  markers.push({
    time: t.exitTime, position: "aboveBar", color: t.reason === "free" ? "#ffd54f" : t.pnl > 0 ? "#26a69a" : "#ef5350", shape: "arrowDown",
    text: (t.reason === "free" ? "TAKE COST +" : "SELL " + (t.returnPct >= 0 ? "+" : "")) + t.returnPct.toFixed(1) + "%",
  });
  // Entry -> exit line per trade
  const seg = chart.addLineSeries({
    color: t.pnl > 0 ? "rgba(38,166,154,.9)" : "rgba(239,83,80,.9)", lineWidth: 2, lineStyle: 2,
    priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
  });
  seg.setData(t.entryTime === t.exitTime
    ? [{ time: t.entryTime, value: t.entryPrice }]
    : [{ time: t.entryTime, value: t.entryPrice }, { time: t.exitTime, value: t.exitPrice }]);
}
markers.sort((a, b) => a.time - b.time);
const legendEl = document.getElementById("legend");
for (const item of legend) {
  const label = document.createElement("label");
  label.innerHTML = '<input type="checkbox" checked><i style="background:' + item.color + '"></i>' + item.name;
  label.querySelector("input").addEventListener("change", (e) =>
    item.series.forEach((x) => x.applyOptions({ visible: e.target.checked })));
  legendEl.appendChild(label);
}
candles.setMarkers(markers);

const eqEl = document.getElementById("equity");
const eq = LightweightCharts.createChart(eqEl, base);
eq.addAreaSeries({ lineColor: "#2196f3", topColor: "rgba(33,150,243,.3)", bottomColor: "rgba(33,150,243,0)", lineWidth: 2 })
  .setData(D.equity);

// Keep both charts' time ranges in sync
let syncing = false;
const link = (a, b) => a.timeScale().subscribeVisibleLogicalRangeChange((r) => {
  if (syncing || !r) return;
  syncing = true; b.timeScale().setVisibleLogicalRange(r); syncing = false;
});
link(chart, eq); link(eq, chart);

const resize = () => {
  chart.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight });
  eq.applyOptions({ width: eqEl.clientWidth, height: eqEl.clientHeight });
};
new ResizeObserver(resize).observe(document.body);

const barSec = D.candles.length > 1 ? D.candles[1].time - D.candles[0].time : 60;
document.getElementById("trades").innerHTML = D.trades.map((t, i) =>
  '<tr data-from="' + t.entryTime + '" data-to="' + t.exitTime + '">' +
  '<td>' + (i + 1) + '</td><td>' + fmtTime(t.entryTime) + '</td><td>' + fmtTime(t.exitTime) + '</td>' +
  '<td>' + fmtPx(t.entryPrice) + '</td><td>' + fmtPx(t.exitPrice) + '</td><td>' + t.bars + '</td>' +
  '<td class="' + (t.pnl > 0 ? "pos" : "neg") + '">' + (t.returnPct >= 0 ? "+" : "") + t.returnPct.toFixed(2) + '%</td>' +
  '<td>' + t.reason + '</td></tr>').join("");
document.getElementById("trades").addEventListener("click", (e) => {
  const row = e.target.closest("tr");
  if (!row) return;
  const pad = barSec * 40;
  chart.timeScale().setVisibleRange({ from: +row.dataset.from - pad, to: +row.dataset.to + pad });
  window.scrollTo({ top: 0, behavior: "smooth" });
});

chart.timeScale().fitContent();
</script>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
