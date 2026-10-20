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
        ? `<p class="signal">${s.costRecovered ? "Free ride" : "Holding"}</p>
           ${s.costRecovered ? `<p class="muted">Cost recovered · 10% kept free — ${esc(s.strategyNote)}</p>` : ""}
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
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    // Top first; flip below when it doesn't fit above; clamp inside the popup either way.
    const below = r.top - gap - h < pad && r.bottom + gap + h <= vh - pad;
    el.classList.toggle("bottom", below);
    const top = below ? r.bottom + gap : r.top - gap - h;
    el.style.top = `${Math.min(Math.max(pad, top), Math.max(pad, vh - h - pad))}px`;
    el.style.left = `${Math.min(Math.max(pad, r.left + r.width / 2 - w / 2), Math.max(pad, vw - w - pad))}px`;
  };
  // Hidden only after the fade-out finishes, unless it was shown again meanwhile.
  let hideAfterFade: ReturnType<typeof setTimeout> | undefined;
  const show = (a: Element, text: string, delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      clearTimeout(hideAfterFade);
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
      const fade = parseFloat(getComputedStyle(el).transitionDuration) * 1000 || 0;
      clearTimeout(hideAfterFade);
      hideAfterFade = setTimeout(() => {
        if (!el.classList.contains("show")) el.hidden = true;
      }, fade);
    }, delay);
  };
  return { show, hide, isOpenOn: (a: Element) => anchor === a };
}

/** Listbox dropdown: click or Enter/Space/↓ opens it, ↑↓ move, Enter selects, Esc/Tab/outside click close. */
/** A listbox picker built from `${id}Trigger`, `${id}Menu` and `${id}Value` in popup.html. */
function dropdown(id: string, initial: string, onChange: (value: string) => void): void {
  const trigger = $(`${id}Trigger`) as HTMLButtonElement;
  const menu = $(`${id}Menu`);
  const options = [...menu.querySelectorAll<HTMLLIElement>('[role="option"]')];
  let active = 0;
  const tip = tooltip();
  const infoOf = (o: HTMLElement) => o.querySelector<HTMLElement>(".info")!;
  // The option's description (also its aria-describedby), kept outside the listbox.
  const tipText = (o: HTMLElement) => document.getElementById(o.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

  const select = (value: string, notify: boolean) => {
    for (const o of options) o.setAttribute("aria-selected", String(o.dataset.value === value));
    const chosen = options.find((o) => o.dataset.value === value) ?? options[0]!;
    $(`${id}Value`).textContent = chosen.querySelector(".name")!.textContent;
    if (notify) onChange(chosen.dataset.value!);
  };
  // Options with aria-disabled="true" are skipped by the keyboard and can't be picked.
  const enabled = (o: HTMLElement) => o.getAttribute("aria-disabled") !== "true";
  /** The next enabled option from i in direction dir (wrapping), or i if none is enabled. */
  const nextEnabled = (i: number, dir: 1 | -1) => {
    for (let n = 0; n < options.length; n++) {
      const k = (((i + dir * n) % options.length) + options.length) % options.length;
      if (enabled(options[k]!)) return k;
    }
    return i;
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
  /** Below the trigger by default; above it when there is more room there. Max height fits the space. */
  const place = () => {
    const r = trigger.getBoundingClientRect();
    const gap = 4;
    const pad = 8;
    const below = window.innerHeight - r.bottom - gap - pad;
    const above = r.top - gap - pad;
    menu.classList.remove("above");
    menu.style.maxHeight = "";
    const natural = Math.min(menu.scrollHeight + 2, 320);
    const flip = natural > below && above > below;
    menu.classList.toggle("above", flip);
    menu.style.maxHeight = `${Math.max(120, Math.min(320, flip ? above : below))}px`;
  };
  const open = () => {
    menu.hidden = false;
    place();
    trigger.setAttribute("aria-expanded", "true");
    setActive(nextEnabled(Math.max(0, options.findIndex((o) => o.getAttribute("aria-selected") === "true")), 1));
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
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setActiveByKey(nextEnabled(active + dir, dir));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActiveByKey(e.key === "Home" ? nextEnabled(0, 1) : nextEnabled(options.length - 1, -1));
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type-to-select: jump to the next option starting with that letter.
      const starts = (o: HTMLElement) => enabled(o) && o.querySelector(".name")!.textContent!.trim().toLowerCase().startsWith(e.key.toLowerCase());
      const k = options.findIndex((o, n) => n > active && starts(o));
      const first = options.findIndex(starts);
      if (k >= 0 || first >= 0) setActiveByKey(k >= 0 ? k : first);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!enabled(options[active]!)) return;
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
    // Touch has no hover: tapping the info icon toggles the description instead of picking the option.
    info.addEventListener("click", (e) => {
      e.stopPropagation();
      if (tip.isOpenOn(info)) tip.hide(0);
      else tip.show(info, tipText(o), 0);
    });
    o.addEventListener("mousemove", () => {
      if (enabled(o)) setActive(k);
    });
    o.addEventListener("click", () => {
      if (!enabled(o)) return;
      select(o.dataset.value!, true);
      close();
    });
  });
  // pointerdown covers mouse, pen and touch.
  document.addEventListener("pointerdown", (e) => {
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
  for (const name of ["showTable", "drawMarkers", "showStop", "showIndicators", "notify"] as const) {
    const input = $(name) as HTMLInputElement;
    input.checked = settings[name];
    input.addEventListener("change", () => void chrome.storage.local.set({ [name]: input.checked }));
  }
  dropdown("strategy", settings.strategy, (value) => void chrome.storage.local.set({ strategy: value }));

  // Table opacity: 20–100% in 5% steps; greyed out while the table is hidden.
  const opacity = $("tableOpacity") as HTMLInputElement;
  const showTable = $("showTable") as HTMLInputElement;
  const paintOpacity = () => {
    const pct = Number(opacity.value);
    $("tableOpacityValue").textContent = `${pct}%`;
    opacity.style.setProperty("--fill", `${((pct - 20) / 80) * 100}%`);
    opacity.disabled = !showTable.checked;
    $("opacityRow").classList.toggle("disabled", opacity.disabled);
  };
  opacity.value = String(Math.round(settings.tableOpacity * 100));
  paintOpacity();
  opacity.addEventListener("input", () => {
    paintOpacity();
    void chrome.storage.local.set({ tableOpacity: Number(opacity.value) / 100 });
  });
  showTable.addEventListener("change", paintOpacity);

  // Shows a sample alert so the user can check Chrome / the OS let notifications through.
  $("testNotify").addEventListener("click", () => {
    const button = $("testNotify") as HTMLButtonElement;
    button.disabled = true;
    chrome.notifications.getPermissionLevel((level) => {
      chrome.notifications.create(
        { type: "basic", iconUrl: "icon128.png", title: "EA BUY · test", message: "Test alert from EA Signals. Real alerts look like this." },
        () => {
          $("testNotifyStatus").textContent =
            level === "granted" ? "" : "Notifications are blocked for this extension.";
          button.disabled = false;
        },
      );
    });
  });

  // Settings is its own page inside the popup.
  const showPage = (settingsOpen: boolean) => {
    $("homePage").hidden = settingsOpen;
    $("settingsPage").hidden = !settingsOpen;
    $(settingsOpen ? "closeSettings" : "openSettings").focus();
  };
  $("openSettings").addEventListener("click", () => showPage(true));
  $("closeSettings").addEventListener("click", () => showPage(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("settingsPage").hidden && $("strategyMenu").hidden) showPage(false);
  });
}

void main();
