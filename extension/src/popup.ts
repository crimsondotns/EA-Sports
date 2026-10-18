// Popup: shows the summary the active tab's content script published, plus settings.
import { DEFAULT_SETTINGS, summaryKey, type Settings, type Summary } from "./messages.ts";

const $ = (id: string) => document.getElementById(id)!;
const fmt = (v: number) => (v === 0 ? "0" : Math.abs(v) >= 1e5 ? `${(v / 1e6).toFixed(3)}M` : Math.abs(v) >= 1 ? v.toFixed(4) : v.toPrecision(4));
const pct = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
const time = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function renderEmpty(onDexScreener: boolean): void {
  $("main").innerHTML = `<section class="empty">
    <p>${onDexScreener ? "Waiting for chart data. Reload the page if nothing shows up." : "Open a pair on DEX Screener to see signals."}</p>
    ${onDexScreener ? "" : `<a class="button-primary" href="https://dexscreener.com" target="_blank" rel="noopener">Open DEX Screener</a>`}
  </section>`;
}

function render(s: Summary): void {
  $("subtitle").textContent = `${s.pair} · ${s.resolution}`;
  const signal =
    s.signal === "buy"
      ? `<p class="signal pos">▲ BUY signal</p><p class="muted">Buy at the open of the next bar</p>`
      : s.signal === "hold"
        ? `<p class="signal">● Holding</p>
           <div class="row num"><span>Entry ${s.entryTime ? time(s.entryTime) : ""}</span><span>${s.entryPrice === null ? "–" : fmt(s.entryPrice)}</span></div>
           <div class="row num"><span>Stop</span><span class="neg">${s.stop === null ? "–" : fmt(s.stop)}</span></div>
           <div class="row num"><span>Open P/L</span><span class="${s.openPnlPct! >= 0 ? "pos" : "neg"}">${pct(s.openPnlPct!, 2)}</span></div>`
        : `<p class="signal">Waiting</p><p class="muted">No position — waiting for a breakout</p>`;
  const st = s.stats;
  $("main").innerHTML = `
    <section>${signal}${s.error ? `<p class="neg">${esc(s.error)}</p>` : ""}</section>
    <section>
      <h2>Entry conditions · last closed bar ${time(s.lastClosed)}</h2>
      ${s.conditions
        .map((c) => `<div class="row num"><span>${c.ok ? '<span class="ok">✓</span>' : '<span class="muted">✕</span>'} ${esc(c.label)}</span><span>${esc(c.detail)}</span></div>`)
        .join("")}
    </section>
    <section>
      <h2>Backtest · ${st.bars} bars · fee + slippage 0.8% per side</h2>
      <div class="grid num">
        <div class="stat"><small>Return</small><strong class="${st.returnPct >= 0 ? "pos" : "neg"}">${pct(st.returnPct)}</strong></div>
        <div class="stat"><small>Max DD</small><strong>${st.maxDdPct.toFixed(1)}%</strong></div>
        <div class="stat"><small>Trades</small><strong>${st.trades}</strong></div>
        <div class="stat"><small>Win rate</small><strong>${st.winRate.toFixed(0)}%</strong></div>
        <div class="stat"><small>PF</small><strong>${Number.isFinite(st.pf) ? st.pf.toFixed(2) : "∞"}</strong></div>
        <div class="stat"><small>Avg W / L</small><strong>${st.avgWin.toFixed(1)} / ${st.avgLoss.toFixed(1)}</strong></div>
      </div>
    </section>
    <section class="muted">
      <div class="row"><span>Chain · DEX</span><span>${esc(s.chain)}${s.dex ? ` · ${esc(s.dex)}` : ""}</span></div>
      <div class="row"><span>Data</span><span>${esc(s.dataSource)}</span></div>
      <div class="row"><span>Chart</span><span>${esc(s.chartStatus)}</span></div>
    </section>`;
}

async function main(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onDexScreener = !!tab?.url?.startsWith("https://dexscreener.com/");
  const key = tab?.id === undefined ? null : summaryKey(tab.id);

  const show = (s: Summary | undefined) => (s && onDexScreener ? render(s) : renderEmpty(onDexScreener));
  show(key ? ((await chrome.storage.session.get(key))[key] as Summary | undefined) : undefined);
  chrome.storage.session.onChanged.addListener((changes) => {
    if (key && changes[key]) show(changes[key].newValue as Summary | undefined);
  });

  const settings = (await chrome.storage.local.get(DEFAULT_SETTINGS)) as Settings;
  for (const name of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const input = $(name) as HTMLInputElement;
    input.checked = settings[name];
    input.addEventListener("change", () => void chrome.storage.local.set({ [name]: input.checked }));
  }
}

void main();
