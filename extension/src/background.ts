// Watches the bars requests the DEX Screener page makes (including ones from its Web Worker) to
// learn each pair's bars URL. It fetches nothing on its own: DEX Screener blocks IPs that send
// too many requests. History is loaded only when the user presses Recalculate in the popup, then
// kept in local storage and handed to the tab's content script from there.
import { decodeBars, type Bar } from "../../src/dexscreener/bars.ts";
import { summaryKey, type BarsSource, type CalcFrom, type FromPopup, type LoadResult, type ToBackground, type ToContent } from "./messages.ts";

// Served from io.dexscreener.com or feed.dexscreener.com. With mc=1 the USD fields are market cap.
const BARS_URL = /^https:\/\/(?:io|feed)\.dexscreener\.com\/dex\/chart\/amm\/v\d+\/([^/]+)\/bars\/([^/]+)\/([^/?]+)/;

const MIN_BARS = 999;

// Recalculate pages back with `bbn` (one request at a time, PAGE_DELAY_MS apart) to about 31
// days plus warm-up, or to the pair's first bar. Each run is capped; after a failed request no
// loading for COOLDOWN_MS.
const PAGE_DELAY_MS = 1500;
const COOLDOWN_MS = 10 * 60_000;
const MAX_PAGES = { "31d": 12, start: 60 } as const;
const inFlight = new Map<string, Promise<LoadResult>>();
let blockedUntil = 0;

const histKey = (s: BarsSource) => `hist:${s.chain}:${s.pairId.toLowerCase()}:${s.resolution}:${s.marketCap}`;
interface StoredHistory { at: number; bars: Bar[]; complete: boolean }

async function storedHistory(source: BarsSource): Promise<StoredHistory | null> {
  const key = histKey(source);
  return ((await chrome.storage.local.get(key))[key] as StoredHistory | undefined) ?? null;
}

async function fetchPage(source: BarsSource, before: number | null): Promise<Bar[]> {
  const u = new URL(source.url);
  u.searchParams.set("cb", "999");
  if (before === null) u.searchParams.delete("bbn");
  else u.searchParams.set("bbn", String(before));
  const res = await fetch(u, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return decodeBars(new Uint8Array(await res.arrayBuffer()));
}

function loadHistory(source: BarsSource, from: CalcFrom): Promise<LoadResult> {
  const key = `${histKey(source)}:${from}`;
  const running = inFlight.get(key);
  if (running) return running;
  const run = pageBack(source, from).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

async function pageBack(source: BarsSource, from: CalcFrom): Promise<LoadResult> {
  if (Date.now() < blockedUntil) {
    return { ok: false, bars: 0, firstTime: null, complete: false, error: `DEX Screener refused a request; try again in ${Math.ceil((blockedUntil - Date.now()) / 60_000)} min.` };
  }
  const need = Math.ceil((31 * 1440) / source.resolution) + 250;
  const pages: Bar[][] = [];
  let total = 0;
  let before: number | null = null;
  let complete = false;
  let error: string | null = null;
  for (let k = 0; k < MAX_PAGES[from] && (from === "start" || total < need); k++) {
    if (k > 0) await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    let page: Bar[];
    try {
      page = await fetchPage(source, before);
    } catch (e) {
      blockedUntil = Date.now() + COOLDOWN_MS;
      error = `DEX Screener refused a request (${(e as Error).message}); try again in 10 min.`;
      break;
    }
    if (page.length) pages.unshift(page);
    total += page.length;
    if (page.length < 999) {
      complete = true;
      break;
    }
    before = page[0]!.blockNumberStart;
  }
  const seen = new Set<number>();
  const bars = pages.flat().filter((b) => !seen.has(b.timestamp) && seen.add(b.timestamp));
  if (bars.length) {
    // Keep the longer of what we had and what we got.
    const old = await storedHistory(source);
    const keepOld = old && old.bars.length && old.bars[0]!.timestamp < bars[0]!.timestamp && old.bars.at(-1)!.timestamp >= bars[0]!.timestamp;
    const merged = keepOld ? [...old.bars.filter((b) => b.timestamp < bars[0]!.timestamp), ...bars] : bars;
    const stored: StoredHistory = { at: Date.now(), bars: merged, complete: complete || !!(keepOld && old.complete) };
    await chrome.storage.local.set({ [histKey(source)]: stored }).catch(() => {
      error ??= "History too large to keep; it is used for this view only.";
    });
    return { ok: !error, bars: merged.length, firstTime: merged[0]!.timestamp, complete: stored.complete, error };
  }
  return { ok: false, bars: 0, firstTime: null, complete: false, error: error ?? "DEX Screener returned no bars." };
}

// The MV3 service worker is stopped when idle, so the latest source per pair lives in session storage.
const storageKey = (chain: string, pairId: string) => `src:${chain}:${pairId.toLowerCase()}`;

function parseSource(url: string): BarsSource | null {
  const m = BARS_URL.exec(url);
  if (!m) return null;
  const u = new URL(url);
  // Paging requests (bbn set) are older history; only follow the latest-bars request.
  if (u.searchParams.get("bbn")) return null;
  // The page also polls with tiny counts (cb=1..2); always ask for enough history.
  u.searchParams.set("cb", String(Math.max(MIN_BARS, Number(u.searchParams.get("cb")) || 0)));
  return {
    dex: m[1]!,
    chain: m[2]!,
    pairId: m[3]!,
    quoteToken: u.searchParams.get("q") ?? "",
    resolution: Number(u.searchParams.get("res")),
    marketCap: u.searchParams.get("mc") === "1",
    url: u.toString(),
  };
}

/** Hands the stored history (no network) to the tab. */
async function pushBars(tabId: number, source: BarsSource): Promise<void> {
  const h = await storedHistory(source);
  const msg: ToContent = { type: "bars", source, bars: h?.bars ?? [], complete: h?.complete ?? false };
  chrome.tabs.sendMessage(tabId, msg).catch(() => {
    // Tab has no content script (yet); its startup refresh will pick the source up.
  });
}

/** Tabs currently showing this pair (pair ids in page URLs are lowercased). */
async function tabsForPair(chain: string, pairId: string): Promise<number[]> {
  const tabs = await chrome.tabs.query({ url: `https://dexscreener.com/${chain}/*` });
  return tabs
    .filter((t) => t.id !== undefined && t.url?.toLowerCase().includes(pairId.toLowerCase()))
    .map((t) => t.id!);
}

function pairFromTabUrl(url: string | undefined): { chain: string; pairId: string } | null {
  const m = url && /^https:\/\/dexscreener\.com\/([^/?#]+)\/([^/?#]+)/.exec(url);
  return m ? { chain: m[1]!, pairId: m[2]! } : null;
}

async function onBarsUrl(url: string, tabId: number): Promise<void> {
  const source = parseSource(url);
  if (!source) return;
  const key = storageKey(source.chain, source.pairId);
  const prev = (await chrome.storage.session.get(key))[key] as BarsSource | undefined;
  // The page polls every few seconds; only a new pair, timeframe or price view needs a push.
  if (prev?.url === source.url) return;
  await chrome.storage.session.set({ [key]: source });
  // Worker requests may have tabId -1, so match tabs by the pair in their URL.
  const tabIds = tabId >= 0 ? [tabId] : await tabsForPair(source.chain, source.pairId);
  for (const id of tabIds) await pushBars(id, source);
}

chrome.webRequest.onCompleted.addListener(
  (details) => {
    // Our own re-fetches come from the extension origin.
    if (details.initiator?.startsWith("chrome-extension://")) return;
    void onBarsUrl(details.url, details.tabId);
  },
  { urls: ["https://io.dexscreener.com/dex/chart/*", "https://feed.dexscreener.com/dex/chart/*"] },
);

async function sourceForTab(tabId: number): Promise<BarsSource | null> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const pair = pairFromTabUrl(tab?.url);
  if (!pair) return null;
  const key = storageKey(pair.chain, pair.pairId);
  return ((await chrome.storage.session.get(key))[key] as BarsSource | undefined) ?? null;
}

chrome.runtime.onMessage.addListener((msg: ToBackground | FromPopup, sender, reply) => {
  if (msg.type === "load") {
    void sourceForTab(msg.tabId).then(async (source) => {
      if (!source) {
        reply({ ok: false, bars: 0, firstTime: null, complete: false, error: "No chart seen on this tab yet. Open a pair's chart first." } satisfies LoadResult);
        return;
      }
      const result = await loadHistory(source, msg.from);
      await pushBars(msg.tabId, source);
      reply(result);
    });
    return true;
  }
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;
  if (msg.type === "summary") {
    void chrome.storage.session.set({ [summaryKey(tabId)]: msg.summary });
  } else if (msg.type === "barsUrl") {
    void onBarsUrl(msg.url, tabId);
  } else if (msg.type === "refresh") {
    const pair = pairFromTabUrl(sender.tab?.url);
    if (!pair) return;
    const key = storageKey(pair.chain, pair.pairId);
    void chrome.storage.session.get(key).then((r) => {
      const source = r[key] as BarsSource | undefined;
      if (source) void pushBars(tabId, source);
    });
  } else if (msg.type === "notify") {
    // A relative icon path resolves against dist/background.js (no such file there) and Chrome drops the alert.
    chrome.notifications.create({ type: "basic", iconUrl: chrome.runtime.getURL("icon128.png"), title: msg.title, message: msg.message }, () => {
      if (chrome.runtime.lastError) console.warn("[EA] notification failed:", chrome.runtime.lastError.message);
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => void chrome.storage.session.remove(summaryKey(tabId)));
