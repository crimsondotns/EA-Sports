// Popup: shows the summary the active tab's content script published, plus settings.
import { L, setLang, tr, translatePage } from "./i18n.ts";
import { DEFAULT_SETTINGS, summaryKey, type CalcFrom, type FromPopup, type LoadResult, type Settings, type Summary } from "./messages.ts";

const $ = (id: string) => document.getElementById(id)!;
// Compact like the chart's axis: 54.58K, 50.20M, 1.234B; small prices keep 4 significant digits.
const fmt = (v: number) => {
  const a = Math.abs(v);
  return v === 0 ? "0" : a >= 1e9 ? `${(v / 1e9).toFixed(3)}B` : a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(2)}K` : a >= 1 ? v.toFixed(4) : v.toPrecision(4);
};
const pct = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
const time = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function renderEmpty(onDexScreener: boolean): void {
  $("title").textContent = "EA Signals";
  $("subtitle").textContent = tr("DEX Screener signals");
  $("main").innerHTML = `<section class="empty">
    <p>${onDexScreener ? L("Waiting for chart data. Reload the page if nothing shows up.", "รอข้อมูลกราฟ ถ้าไม่ขึ้นให้รีโหลดหน้า") : L("Open a pair on DEX Screener to see signals.", "เปิดเหรียญบน DEX Screener เพื่อดูสัญญาณ")}</p>
    ${onDexScreener ? "" : `<a class="button-primary" href="https://dexscreener.com" target="_blank" rel="noopener">${L("Open DEX Screener", "เปิด DEX Screener")}</a>`}
  </section>`;
}

/** How far a failing "Fell ≥10% in 6 bars" check still has to go, e.g. "3.8% more fall". */
function missing(c: Summary["conditions"][number]): string {
  const need = /^Fell ≥(\d+(?:\.\d+)?)%/.exec(c.label);
  const now = parseFloat(c.detail);
  if (need && Number.isFinite(now)) return `<b>${L(`${(Number(need[1]) - now).toFixed(1)}% more fall`, `ร่วงอีก ${(Number(need[1]) - now).toFixed(1)}%`)}</b>`;
  return `<b>${esc(tr(c.label).toLowerCase())}</b>`;
}

/** The pair in this tab (design G): a gate of buy checks while waiting, the trade plan while holding. */
function render(s: Summary): void {
  $("title").textContent = s.pair;
  $("subtitle").textContent = `${s.strategy} · ${s.resolution} · ${L("last bar closed", "แท่งล่าสุดปิด")} ${time(s.lastClosed)}`;
  const st = s.stats;
  const backtest = `<p class="backtest num">${L(`Backtest ${st.bars.toLocaleString()} bars:`, `Backtest ${st.bars.toLocaleString()} แท่ง:`)} <span class="${st.returnPct >= 0 ? "pos" : "neg"}">${pct(st.returnPct)}</span>, ${L(`${st.trades} trades, ${st.winRate.toFixed(0)}% won, max drawdown ${st.maxDdPct.toFixed(1)}%`, `${st.trades} ไม้ ชนะ ${st.winRate.toFixed(0)}% drawdown สูงสุด ${st.maxDdPct.toFixed(1)}%`)}</p>`;
  const error = s.error ? `<p class="note neg">${esc(s.error)}</p>` : "";
  if (s.signal === "hold") {
    const pnl = s.openPnlPct ?? 0;
    // Stop as its distance from the entry, and the entry time as how long the trade has been held.
    const stopGap = s.stop !== null && s.entryPrice ? `<small>${pct((s.stop / s.entryPrice - 1) * 100, 1)}</small>` : "";
    const heldMin = s.entryTime ? Math.max(0, Math.round((Date.now() - s.entryTime) / 60000)) : null;
    const held = heldMin === null ? "–"
      : `${heldMin < 60 ? `${heldMin}m` : heldMin < 1440 ? `${Math.floor(heldMin / 60)}h ${heldMin % 60}m` : `${Math.floor(heldMin / 1440)}d ${Math.floor((heldMin % 1440) / 60)}h`}<small>${new Date(s.entryTime!).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</small>`;
    $("main").innerHTML = `<div class="gate num">
      <p class="score"><b class="${pnl >= 0 ? "pos" : "neg"}">${pct(pnl, 1)}</b><span>${s.costRecovered ? L("free ride", "ฟรีไรด์") : L("open", "เปิดอยู่")}</span></p>
      <dl class="plan">
        <div><dt>${tr("Bought")}</dt><dd>${s.entryPrice === null ? "–" : fmt(s.entryPrice)}</dd></div>
        <div><dt>${tr("Stop")}</dt><dd><span class="neg">${s.stop === null ? "–" : fmt(s.stop)}</span>${stopGap}</dd></div>
        <div><dt>${tr("Held")}</dt><dd>${held}</dd></div>
      </dl>
      <p class="note">${esc(s.strategyNote)}</p>${error}${backtest}</div>`;
    return;
  }
  const n = s.conditions.length;
  const ok = s.conditions.filter((c) => c.ok).length;
  const buy = s.signal === "buy";
  const cells = s.conditions
    .map((c) => `<div class="${c.ok ? "ok" : "need"}" title="${esc(c.label)}"><small>${esc(tr(c.label))}</small><b>${esc(c.detail.split(" vs ")[0]!)}</b></div>`)
    .join("");
  const failing = s.conditions.filter((c) => !c.ok);
  const pl = s.plan;
  const note = buy
    ? `<p class="note"><span class="pos">${L("All checks passed.", "ผ่านทุกเงื่อนไข")}</span> ${L("Buy at the open of the next bar.", "ซื้อที่ราคาเปิดของแท่งถัดไป")}</p>`
    : failing.length
      ? `<p class="note">${L("Still needs", "ยังขาด")} ${failing.map(missing).join(", ")}${pl && !pl.inZone ? L(`. Next setup ${pct(pl.distancePct)} away.`, ` · setup ถัดไปห่าง ${pct(pl.distancePct)}`) : L(".", "")}</p>`
      : `<p class="note">${L("No setup yet for this strategy.", "กลยุทธ์นี้ยังไม่มี setup")}</p>`;
  $("main").innerHTML = `<div class="gate num">
    <p class="score"><b class="${buy ? "pos" : ""}">${ok}/${n}</b><span>${buy ? L("buy at the next open", "ซื้อที่ราคาเปิดแท่งถัดไป") : L("buy checks passed", "เงื่อนไขซื้อที่ผ่าน")}</span></p>
    <div class="meter" style="--n:${Math.min(Math.max(n, 1), 3)}">${cells}</div>
    ${note}${error}${backtest}</div>`;
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
function dropdown(id: string, initial: string, onChange: (value: string) => void): { select: (value: string) => void } {
  const trigger = $(`${id}Trigger`) as HTMLButtonElement;
  const menu = $(`${id}Menu`);
  const options = [...menu.querySelectorAll<HTMLLIElement>('[role="option"]')];
  let active = 0;
  const tip = tooltip();
  // Options may carry an info icon whose tooltip describes them (the strategy picker); others have none.
  const infoOf = (o: HTMLElement) => o.querySelector<HTMLElement>(".info");
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
    const info = infoOf(options[active]!);
    if (info) tip.show(info, tipText(options[active]!), 0);
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
    if (info) {
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
    }
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
    if (!menu.hidden && (e.target as Element).closest(".dropdown") !== menu.parentElement) close(false);
  });
  select(initial, false);
  return { select: (value) => select(value, false) };
}

/** Strategy drawer: a bottom sheet with every strategy; picking one saves it and closes. Esc, the scrim or ✕ close it. */
function drawer(initial: string, onChange: (value: string) => void): void {
  const trigger = $("strategyTrigger") as HTMLButtonElement;
  const root = $("strategyDrawer");
  const options = [...root.querySelectorAll<HTMLButtonElement>("[data-value]")];
  const select = (value: string) => {
    const chosen = options.find((o) => o.dataset.value === value) ?? options[0]!;
    for (const o of options) o.setAttribute("aria-pressed", String(o === chosen));
    $("strategyValue").textContent = chosen.querySelector(".name")!.textContent;
    return chosen;
  };
  const close = () => {
    root.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus();
  };
  trigger.addEventListener("click", () => {
    root.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    (options.find((o) => o.getAttribute("aria-pressed") === "true") ?? options[0]!).focus();
  });
  for (const o of options) o.addEventListener("click", () => {
    onChange(select(o.dataset.value!).dataset.value!);
    close();
  });
  for (const c of root.querySelectorAll("[data-close]")) c.addEventListener("click", close);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = options.indexOf(document.activeElement as HTMLButtonElement);
      options[(i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]!.focus();
    } else if (e.key === "Tab") {
      // Keep focus inside the open sheet.
      const f = [...root.querySelectorAll<HTMLElement>("button")];
      const at = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey ? at <= 0 : at === f.length - 1) {
        e.preventDefault();
        f[e.shiftKey ? f.length - 1 : 0]!.focus();
      }
    }
  });
  select(initial);
}

// ---------- watchlist: every open DEX Screener tab's latest summary ----------

const RANK = { buy: 0, zone: 1, hold: 2, flat: 3 } as const;
// Filter chips and search for the list; they show from this many pairs up.
const FILTER_FROM = 5;
const FILTERS = { all: [0, 1, 2, 3], signals: [0, 1], holding: [2], waiting: [3] } as const;
let watchFilter: keyof typeof FILTERS = "all";
let watchQuery = "";

async function renderWatchlist(currentTab?: number): Promise<void> {
  const tabs = (await chrome.tabs.query({ url: "https://dexscreener.com/*" })).filter((t) => t.id !== currentTab);
  const stored = await chrome.storage.session.get(tabs.map((t) => summaryKey(t.id!)));
  const rows = tabs
    .map((t) => ({ tab: t, s: stored[summaryKey(t.id!)] as Summary | undefined }))
    .filter((r): r is { tab: chrome.tabs.Tab; s: Summary } => !!r.s)
    .map((r) => ({ ...r, rank: RANK[r.s.signal === "flat" && r.s.plan?.inZone ? "zone" : r.s.signal] }))
    // BUY first, then price in the buy zone, then open trades by P/L, then waiting.
    .sort((a, b) => a.rank - b.rank || (b.s.openPnlPct ?? 0) - (a.s.openPnlPct ?? 0));
  $("watchCount").textContent = rows.length ? String(rows.length) : "";
  $("watchFilters").hidden = rows.length < FILTER_FROM;
  for (const [k, ranks] of Object.entries(FILTERS)) {
    $(`count${k[0]!.toUpperCase()}${k.slice(1)}`).textContent = String(rows.filter((r) => (ranks as readonly number[]).includes(r.rank)).length);
  }
  if (!rows.length) {
    $("watchlist").innerHTML = `<li><p class="watch-empty">${L("Open more pairs on DEX Screener in other tabs to watch them here.", "เปิดเหรียญอื่นบน DEX Screener ในแท็บอื่น เพื่อดูที่นี่")}</p></li>`;
    return;
  }
  const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60_000);
    return m < 1 ? L("now", "เมื่อกี้") : m < 60 ? L(`${m}m ago`, `${m} นาทีก่อน`) : L(`${Math.round(m / 60)}h ago`, `${Math.round(m / 60)} ชม. ก่อน`);
  };
  const q = watchQuery.trim().toLowerCase();
  const shown = rows.length < FILTER_FROM ? rows
    : rows.filter((r) => (FILTERS[watchFilter] as readonly number[]).includes(r.rank) && (!q || r.s.pair.toLowerCase().includes(q)));
  if (!shown.length) {
    $("watchlist").innerHTML = `<li><p class="watch-empty">${q ? L("No pairs match your search.", "ไม่มีเหรียญที่ตรงกับคำค้น") : L("No pairs in this group.", "ไม่มีเหรียญในกลุ่มนี้")}</p></li>`;
    return;
  }
  $("watchlist").innerHTML = shown
    .map(({ tab, s, rank }) => {
      const state =
        rank === 0
          ? `<strong class="pos">▲ ${L("BUY", "ซื้อ")}</strong><small>${L("next bar open", "เปิดแท่งถัดไป")}</small>`
          : rank === 1
            ? `<strong class="pos">${tr("In zone")}</strong><small>${L("waiting for the trigger", "รอสัญญาณ")}</small>`
            : rank === 2
              ? `<strong class="${(s.openPnlPct ?? 0) >= 0 ? "pos" : "neg"}">${pct(s.openPnlPct ?? 0, 2)}</strong><small>${tr(s.costRecovered ? "Free ride" : "Holding")}</small>`
              : `<strong class="muted">${tr("Waiting")}</strong><small>${s.plan ? L(`${pct(s.plan.distancePct)} to zone`, `ห่างโซน ${pct(s.plan.distancePct)}`) : L("no setup", "ไม่มี setup")}</small>`;
      const gate = s.signal === "hold" ? "" : `<span class="seg3" aria-hidden="true">${s.conditions.map((c) => `<i class="${c.ok ? "ok" : ""}"></i>`).join("")}</span>`;
      return `<li><button type="button" data-tab="${tab.id}" data-window="${tab.windowId}">
        <span class="name"><strong>${esc(s.pair)}</strong><small>${esc(s.resolution)} · ${esc(s.strategy)} · ${ago(s.updatedAt)}${s.error ? L(" · error", " · ผิดพลาด") : ""}</small></span>
        ${gate}<span class="state">${state}</span></button></li>`;
    })
    .join("");
}

async function main(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onDexScreener = !!tab?.url?.startsWith("https://dexscreener.com/");
  const key = tab?.id === undefined ? null : summaryKey(tab.id);

  const settings = (await chrome.storage.local.get(DEFAULT_SETTINGS)) as Settings;
  setLang(settings.lang);
  translatePage(document.body);
  let current: Summary | undefined;
  const show = (s: Summary | undefined) => ((current = s), s && onDexScreener ? render(s) : renderEmpty(onDexScreener));
  show(key ? ((await chrome.storage.session.get(key))[key] as Summary | undefined) : undefined);
  chrome.storage.session.onChanged.addListener((changes) => {
    if (key && changes[key]) show(changes[key].newValue as Summary | undefined);
  });

  for (const name of ["showTable", "hoverExpand", "drawMarkers", "showStop", "showIndicators", "notify"] as const) {
    const input = $(name) as HTMLInputElement;
    input.checked = settings[name];
    input.addEventListener("change", () => void chrome.storage.local.set({ [name]: input.checked }));
  }
  // A removed strategy (Quiet Accumulation, Range Swing) shows as Deep Dip, like the chart runs it.
  const strategy = document.getElementById(`opt-${settings.strategy}`) ? settings.strategy : "dip";
  drawer(strategy, (value) => void chrome.storage.local.set({ strategy: value }));

  // Table opacity: 20–100% in 5% steps; greyed out while the table is hidden.
  const opacity = $("tableOpacity") as HTMLInputElement;
  const showTable = $("showTable") as HTMLInputElement;
  const paintOpacity = () => {
    const pct = Number(opacity.value);
    $("tableOpacityValue").textContent = `${pct}%`;
    opacity.style.setProperty("--fill", `${((pct - 20) / 68) * 100}%`);
    opacity.disabled = !showTable.checked;
    $("opacityRow").classList.toggle("disabled", opacity.disabled);
  };
  // The chart panel is the exception to the 72–88% glass rule: 20–88%, so the blur shows (as in Keepit).
  opacity.value = String(Math.min(88, Math.max(20, Math.round(settings.tableOpacity * 100))));
  paintOpacity();
  opacity.addEventListener("input", () => {
    paintOpacity();
    void chrome.storage.local.set({ tableOpacity: Number(opacity.value) / 100 });
  });
  showTable.addEventListener("change", paintOpacity);
  // Background blur: 0–32 px in 2 px steps, greyed out with the opacity slider.
  const blur = $("tableBlur") as HTMLInputElement;
  const paintBlur = () => {
    $("tableBlurValue").textContent = Number(blur.value) ? `${blur.value}px` : tr("Off");
    blur.style.setProperty("--fill", `${(Number(blur.value) / 32) * 100}%`);
    blur.disabled = !showTable.checked;
    $("blurRow").classList.toggle("disabled", blur.disabled);
  };
  blur.value = String(settings.tableBlur);
  paintBlur();
  blur.addEventListener("input", () => {
    paintBlur();
    void chrome.storage.local.set({ tableBlur: Number(blur.value) });
  });
  showTable.addEventListener("change", paintBlur);

  // Calculate from: the choice applies at once to the chart; Recalculate loads the history it
  // needs (the only requests the extension sends to DEX Screener, one page every 1.5 s).
  const hints = {
    "31d": "Signals from a fixed point 31 days back. Loads up to 12 pages.",
    start: "Signals from the pair's first bar. Loads the whole history once, up to 60 pages.",
  } as const;
  let calcFrom = settings.calcFrom;
  const paintCalc = (v: CalcFrom) => ($("calcHint").textContent = tr(hints[v]));
  dropdown("calc", calcFrom, (value) => {
    calcFrom = value as CalcFrom;
    paintCalc(calcFrom);
    void chrome.storage.local.set({ calcFrom });
  });
  paintCalc(calcFrom);
  const recalc = $("recalc") as HTMLButtonElement;
  recalc.disabled = !onDexScreener || tab?.id === undefined;
  if (recalc.disabled) $("recalcStatus").textContent = tr("Open a pair's chart first.");
  recalc.addEventListener("click", () => {
    const from = calcFrom;
    recalc.disabled = true;
    recalc.textContent = tr("Loading…");
    $("recalcStatus").textContent = "";
    void chrome.runtime.sendMessage({ type: "load", tabId: tab!.id!, from } satisfies FromPopup).then((r: LoadResult) => {
      const since = r.firstTime === null ? "" : ` from ${new Date(r.firstTime).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
      $("recalcStatus").textContent = r.error ?? `${r.bars.toLocaleString()} bars${since}${from === "start" && !r.complete ? " (not the pair's start: page limit)" : ""}`;
      recalc.disabled = false;
      recalc.textContent = tr("Recalculate");
    });
  });

  // Shows a sample alert so the user can check Chrome / the OS let notifications through.
  $("testNotify").addEventListener("click", () => {
    const button = $("testNotify") as HTMLButtonElement;
    button.disabled = true;
    chrome.notifications.getPermissionLevel((level) => {
      chrome.notifications.create(
        { type: "basic", iconUrl: chrome.runtime.getURL("icon128.png"), title: "EA BUY · test", message: "Test alert from EA Signals. Real alerts look like this." },
        () => {
          const err = chrome.runtime.lastError?.message;
          $("testNotifyStatus").textContent = err
            ? L(`Could not show the alert: ${err}`, `แสดงการแจ้งเตือนไม่ได้: ${err}`)
            : level === "granted" ? "" : tr("Notifications are blocked for this extension.");
          button.disabled = false;
        },
      );
    });
  });

  // Theme: the header switch and Settings → Appearance set the same setting.
  const paintTheme = (t: Settings["theme"]) => {
    document.documentElement.dataset.theme = t;
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-theme-set]")) b.setAttribute("aria-pressed", String(b.dataset.themeSet === t));
    themePicker.select(t);
  };
  const themePicker = dropdown("theme", settings.theme, (value) => setTheme(value as Settings["theme"]));
  const setTheme = (t: Settings["theme"]) => {
    paintTheme(t);
    void chrome.storage.local.set({ theme: t });
  };
  paintTheme(settings.theme);
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-theme-set]")) b.addEventListener("click", () => setTheme(b.dataset.themeSet as Settings["theme"]));

  // Language: the TH / EN switch in the header; the popup re-renders and the chart panel follows the setting.
  const paintLang = (l: Settings["lang"]) => {
    setLang(l);
    document.documentElement.lang = l;
  };
  paintLang(settings.lang);
  dropdown("lang", settings.lang, (value) => {
    const l = value as Settings["lang"];
    paintLang(l);
    translatePage(document.body);
    show(current);
    void renderWatchlist(tab?.id);
    paintCalc(calcFrom);
    paintBlur();
    paintAlerts();
    if (recalc.disabled) $("recalcStatus").textContent = tr("Open a pair's chart first.");
    void chrome.storage.local.set({ lang: l });
  });

  const notifyInput = $("notify") as HTMLInputElement;
  const paintAlerts = () => ($("alertState").textContent = tr(notifyInput.checked ? "Alerts on" : "Alerts off"));
  paintAlerts();
  notifyInput.addEventListener("change", paintAlerts);

  // Settings is its own page inside the popup; the other open pairs live on the home page.
  type Page = "home" | "settings";
  let page: Page = "home";
  const showPage = (next: Page) => {
    page = next;
    $("homePage").hidden = next !== "home";
    $("settingsPage").hidden = next !== "settings";
    $(next === "home" ? "openSettings" : "closeSettings").focus();
  };
  $("openSettings").addEventListener("click", () => showPage("settings"));
  $("closeSettings").addEventListener("click", () => showPage("home"));
  void renderWatchlist(tab?.id);
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-filter]")) {
    b.addEventListener("click", () => {
      watchFilter = b.dataset.filter as typeof watchFilter;
      for (const o of document.querySelectorAll<HTMLButtonElement>("[data-filter]")) o.setAttribute("aria-pressed", String(o === b));
      void renderWatchlist(tab?.id);
    });
  }
  $("watchSearch").addEventListener("input", (e) => {
    watchQuery = (e.target as HTMLInputElement).value;
    void renderWatchlist(tab?.id);
  });
  // A row switches to its tab (and window).
  $("watchlist").addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button[data-tab]");
    if (!b) return;
    void chrome.tabs.update(Number(b.dataset.tab), { active: true });
    void chrome.windows.update(Number(b.dataset.window), { focused: true });
    window.close();
  });
  chrome.storage.session.onChanged.addListener((changes) => {
    if (Object.keys(changes).some((k) => k.startsWith("summary:"))) void renderWatchlist(tab?.id);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && page !== "home" && $("strategyMenu").hidden) showPage("home");
  });
}

void main();

// The Settings header casts its shadow only once the page has scrolled under it.
const settingsHeader = document.querySelector("#settingsPage > header");
const footer = document.querySelector("body > footer");
const markStuck = () => {
  settingsHeader?.classList.toggle("stuck", window.scrollY > 0);
  // The footer's shadow shows while there is more page under it.
  footer?.classList.toggle("stuck", window.scrollY + window.innerHeight < document.documentElement.scrollHeight - 1);
};
window.addEventListener("scroll", markStuck, { passive: true });
// The list grows and shrinks as pairs and filters change.
new ResizeObserver(markStuck).observe(document.body);
