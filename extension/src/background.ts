// Watches the bars requests the DEX Screener page makes (including ones from its Web Worker),
// then re-fetches the same URL (and the pair's daily bars) and hands them to the tab's content script.
import { decodeBars, type Bar } from "../../src/dexscreener/bars.ts";
import { statusKey, type BarsSource, type ToBackground, type ToContent } from "./messages.ts";

// Served from io.dexscreener.com or feed.dexscreener.com. With mc=1 the USD fields are market cap.
const BARS_URL = /^https:\/\/(?:io|feed)\.dexscreener\.com\/dex\/chart\/amm\/v\d+\/([^/]+)\/bars\/([^/]+)\/([^/?]+)/;

const MIN_BARS = 999;

// Daily bars are cached for DAILY_TTL_MS in session storage (the service worker is stopped when
// idle, which would empty a Map). DEX Screener has blocked an IP for bulk requests before: after
// a failed request, no daily fetch for COOLDOWN_MS.
const DAILY_TTL_MS = 15 * 60_000;
const COOLDOWN_MS = 10 * 60_000;
let blockedUntil = 0;

// Daily bars for the ATH close: one request (999 days) per pair, cached in session storage.
async function dailyBars(source: BarsSource): Promise<Bar[]> {
  const key = `day:${source.chain}:${source.pairId.toLowerCase()}:${source.marketCap}`;
  const hit = (await chrome.storage.session.get(key))[key] as { at: number; bars: Bar[] } | undefined;
  if (hit && Date.now() - hit.at < DAILY_TTL_MS) return hit.bars;
  if (source.resolution === 1440) return [];
  if (Date.now() < blockedUntil) return hit?.bars ?? [];
  const u = new URL(source.url);
  u.searchParams.set("res", "1440");
  u.searchParams.set("cb", "999");
  let bars: Bar[];
  try {
    const res = await fetch(u, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bars = decodeBars(new Uint8Array(await res.arrayBuffer()));
  } catch {
    blockedUntil = Date.now() + COOLDOWN_MS;
    return hit?.bars ?? [];
  }
  await chrome.storage.session.set({ [key]: { at: Date.now(), bars } }).catch(() => {});
  return bars;
}

// The MV3 service worker is stopped when idle, so the latest source per pair lives in session storage.
const storageKey = (chain: string, pairId: string) => `src:${chain}:${pairId.toLowerCase()}`;

function parseSource(url: string): BarsSource | null {
  const m = BARS_URL.exec(url);
  if (!m) return null;
  const u = new URL(url);
  // Paging requests (bbn set) are older history; only follow the latest-bars request.
  if (u.searchParams.get("bbn")) return null;
  // The page also polls with tiny counts (cb=1..2); ask for 999 bars (on the daily chart they are the daily bars).
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

async function pushBars(tabId: number, source: BarsSource): Promise<void> {
  let msg: ToContent;
  try {
    const res = await fetch(source.url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bars = decodeBars(new Uint8Array(await res.arrayBuffer()));
    // On the daily chart the bars are the daily bars.
    const daily = source.resolution === 1440 ? bars : await dailyBars(source).catch(() => []);
    msg = { type: "bars", source, bars, daily };
  } catch (e) {
    msg = { type: "error", message: `Fetching bars failed: ${(e as Error).message}` };
  }
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
  await chrome.storage.session.set({ [storageKey(source.chain, source.pairId)]: source });
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

chrome.runtime.onMessage.addListener((msg: ToBackground, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;
  if (msg.type === "status") {
    void chrome.storage.session.set({ [statusKey(tabId)]: msg.status });
  } else if (msg.type === "barsUrl") {
    void onBarsUrl(msg.url, tabId);
  } else if (msg.type === "refresh") {
    const pair = pairFromTabUrl(sender.tab?.url);
    if (!pair) return;
    const key = storageKey(pair.chain, pair.pairId);
    void chrome.storage.session.get(key).then((r) => {
      const source = r[key] as BarsSource | undefined;
      if (source) void pushBars(tabId, source);
      else
        chrome.tabs
          .sendMessage(tabId, { type: "error", message: "No chart request seen yet for this pair — reload the page." } satisfies ToContent)
          .catch(() => {});
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => void chrome.storage.session.remove(statusKey(tabId)));
