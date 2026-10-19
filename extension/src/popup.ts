// Popup: shows the status the active tab's content script published.
import { statusKey, type Status } from "./messages.ts";

const $ = (id: string) => document.getElementById(id)!;
const fmt = (v: number) => (v === 0 ? "0" : Math.abs(v) >= 1e5 ? `${(v / 1e6).toFixed(3)}M` : Math.abs(v) >= 1 ? v.toFixed(4) : v.toPrecision(4));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function renderEmpty(onDexScreener: boolean): void {
  $("main").innerHTML = `<section>
    <p>${onDexScreener ? "Waiting for chart data. Reload the page if nothing shows up." : "Open a pair on DEX Screener to draw on its chart."}</p>
    ${onDexScreener ? "" : `<a class="button-primary" href="https://dexscreener.com" target="_blank" rel="noopener">Open DEX Screener</a>`}
  </section>`;
}

function render(s: Status): void {
  if (s.pair) $("subtitle").textContent = s.pair;
  $("main").innerHTML = `<section>
    <div class="row"><span>ATH close</span><span>${s.athClose === null ? "–" : fmt(s.athClose)}</span></div>
    <div class="row"><span>Chart</span><span>${esc(s.chartStatus)}</span></div>
    ${s.error ? `<div class="row"><span>Error</span><span class="neg">${esc(s.error)}</span></div>` : ""}
  </section>`;
}

void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  const onDexScreener = !!tab?.url?.startsWith("https://dexscreener.com/");
  if (!tab?.id || !onDexScreener) return renderEmpty(onDexScreener);
  const key = statusKey(tab.id);
  const status = (await chrome.storage.session.get(key))[key] as Status | undefined;
  if (status) render(status);
  else renderEmpty(true);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes[key]?.newValue) render(changes[key].newValue as Status);
  });
});
