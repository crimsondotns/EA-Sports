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

function planHtml(s: Summary): string {
  const pl = s.plan;
  if (!pl) return `<p class="muted">No setup yet for this strategy.</p>`;
  const rows =
    pl.kind === "zone"
      ? `<div class="row num"><span>Next buy zone</span><span class="${pl.inZone ? "pos" : ""}">${fmt(pl.low)} – ${fmt(pl.high)}</span></div>
         <div class="row num"><span>${pl.inZone ? "Status" : "Distance"}</span><span>${pl.inZone ? "In zone now" : pct(pl.distancePct)}</span></div>`
      : pl.kind === "below"
        ? `<div class="row num"><span>Buy below</span><span class="${pl.inZone ? "pos" : ""}">${fmt(pl.high)}</span></div>
           <div class="row num"><span>${pl.inZone ? "Status" : "Distance"}</span><span>${pl.inZone ? "Below now" : pct(pl.distancePct)}</span></div>`
        : `<div class="row num"><span>Buy above</span><span>${fmt(pl.high)}</span></div>
         <div class="row num"><span>Distance</span><span>${pct(pl.distancePct)}</span></div>`;
  return `<p class="muted">Next setup — ${esc(pl.waitFor)}</p>${rows}
    <div class="row num"><span>Stop</span><span class="neg">${fmt(pl.stop)}</span></div>
    ${pl.target === null ? "" : `<div class="row num"><span>Cost back (3x)</span><span>${fmt(pl.target)}</span></div>`}`;
}

function render(s: Summary): void {
  $("title").textContent = `EA · ${s.strategy}`;
  $("subtitle").textContent = `${s.pair} · ${s.resolution}`;
  const signal =
    s.signal === "buy"
      ? `<p class="signal pos">▲ BUY signal</p><p class="muted">Buy at the open of the next bar</p>`
      : s.signal === "hold"
        ? `<p class="signal">● ${s.costRecovered ? "Free ride" : "Holding"}</p>
           ${s.costRecovered ? `<p class="muted">Cost sold back, 10% kept free (sold a third each at 10x / 30x / 100x) — the rest trails 35% below the high</p>` : ""}
           <div class="row num"><span>Entry ${s.entryTime ? time(s.entryTime) : ""}</span><span>${s.entryPrice === null ? "–" : fmt(s.entryPrice)}</span></div>
           <div class="row num"><span>Stop</span><span class="neg">${s.stop === null ? "–" : fmt(s.stop)}</span></div>
           <div class="row num"><span>Open P/L</span><span class="${s.openPnlPct! >= 0 ? "pos" : "neg"}">${pct(s.openPnlPct!, 2)}</span></div>`
        : `<p class="signal">Waiting</p>${planHtml(s)}`;
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
      <h2>Backtest · ${st.bars} bars · ${esc(s.strategyNote)}</h2>
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

/**
 * Shared tooltip. Opens ~500ms after hover, right away for keyboard focus or a tap, closes after
 * 100ms. Placed above its anchor, flipped below and shifted sideways to stay inside the popup.
 */
function tooltip() {
  const el = $("tooltip");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let anchor: Element | null = null;
  const place = (a: Element) => {
    const r = a.getBoundingClientRect();
    const gap = 6;
    const pad = 8;
    // Measure at the left edge, so the width isn't squeezed by the previous position.
    el.style.left = "0px";
    el.style.top = "0px";
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = r.top - gap - h < pad;
    el.classList.toggle("bottom", below);
    el.style.top = `${below ? r.bottom + gap : r.top - gap - h}px`;
    el.style.left = `${Math.min(Math.max(pad, r.left + r.width / 2 - w / 2), document.documentElement.clientWidth - w - pad)}px`;
  };
  const show = (a: Element, text: string, delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      anchor?.classList.remove("open");
      anchor = a;
      a.classList.add("open");
      el.textContent = text;
      el.hidden = false;
      place(a);
      requestAnimationFrame(() => el.classList.add("show"));
    }, delay);
  };
  const hide = (delay = 100) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      anchor?.classList.remove("open");
      anchor = null;
      el.classList.remove("show");
      el.hidden = true;
    }, delay);
  };
  return { show, hide, isOpenOn: (a: Element) => anchor === a };
}

/** Listbox dropdown: click or Enter/Space/↓ opens it, ↑↓ move, Enter selects, Esc/Tab/outside click close. */
function strategyDropdown(initial: Settings["strategy"], onChange: (value: Settings["strategy"]) => void): void {
  const trigger = $("strategyTrigger") as HTMLButtonElement;
  const menu = $("strategyMenu");
  const options = [...menu.querySelectorAll<HTMLLIElement>('[role="option"]')];
  let active = 0;
  const tip = tooltip();
  const infoOf = (o: HTMLElement) => o.querySelector<HTMLElement>(".info")!;
  const tipText = (o: HTMLElement) => o.querySelector(".tip")!.textContent ?? "";

  const select = (value: string, notify: boolean) => {
    for (const o of options) o.setAttribute("aria-selected", String(o.dataset.value === value));
    const chosen = options.find((o) => o.dataset.value === value) ?? options[0]!;
    $("strategyValue").textContent = chosen.querySelector(".name")!.textContent;
    if (notify) onChange(chosen.dataset.value as Settings["strategy"]);
  };
  const setActive = (i: number) => {
    active = (i + options.length) % options.length;
    options.forEach((o, k) => o.classList.toggle("active", k === active));
    menu.setAttribute("aria-activedescendant", options[active]!.id);
    options[active]!.scrollIntoView({ block: "nearest" });
  };
  /** Keyboard navigation shows the active option's conditions right away. */
  const setActiveByKey = (i: number) => {
    setActive(i);
    tip.show(infoOf(options[active]!), tipText(options[active]!), 0);
  };
  const open = () => {
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    setActive(Math.max(0, options.findIndex((o) => o.getAttribute("aria-selected") === "true")));
    menu.focus();
  };
  const close = (refocus = true) => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    tip.hide(0);
    if (refocus) trigger.focus();
  };

  trigger.addEventListener("click", () => (menu.hidden ? open() : close()));
  trigger.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      open();
    }
  });
  menu.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActiveByKey(active + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActiveByKey(e.key === "Home" ? 0 : options.length - 1);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type-to-select: jump to the next option starting with that letter.
      const k = options.findIndex((o, n) => n > active && o.textContent!.trim().toLowerCase().startsWith(e.key.toLowerCase()));
      const first = options.findIndex((o) => o.textContent!.trim().toLowerCase().startsWith(e.key.toLowerCase()));
      if (k >= 0 || first >= 0) setActiveByKey(k >= 0 ? k : first);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(options[active]!.dataset.value!, true);
      close();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") close(false);
  });
  options.forEach((o, k) => {
    const info = infoOf(o);
    info.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") tip.show(info, tipText(o), 500);
    });
    info.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") tip.hide();
    });
    // Touch has no hover: tapping the asterisk toggles the conditions instead of picking the option.
    info.addEventListener("click", (e) => {
      e.stopPropagation();
      if (tip.isOpenOn(info)) tip.hide(0);
      else tip.show(info, tipText(o), 0);
    });
    o.addEventListener("mousemove", () => setActive(k));
    o.addEventListener("click", () => {
      select(o.dataset.value!, true);
      close();
    });
  });
  document.addEventListener("mousedown", (e) => {
    if (!menu.hidden && !(e.target as Element).closest(".dropdown")) close(false);
  });
  select(initial, false);
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
  for (const name of ["showTable", "drawMarkers", "showIndicators", "notify"] as const) {
    const input = $(name) as HTMLInputElement;
    input.checked = settings[name];
    input.addEventListener("change", () => void chrome.storage.local.set({ [name]: input.checked }));
  }
  strategyDropdown(settings.strategy, (value) => void chrome.storage.local.set({ strategy: value }));
}

void main();
