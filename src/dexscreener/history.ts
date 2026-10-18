import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fetchBars, type Bar, type FetchBarsParams } from "./bars.ts";

const MAX_BARS_PER_REQUEST = 999;
const PAGE_DELAY_MS = 600;

export interface FetchHistoryParams extends Omit<FetchBarsParams, "countBack" | "beforeBlock"> {
  maxBars?: number;
}

/** Pages backwards with `bbn` until the pool's first bar or `maxBars`. Oldest first. */
export async function fetchBarsHistory(p: FetchHistoryParams): Promise<Bar[]> {
  const maxBars = p.maxBars ?? Infinity;
  const pages: Bar[][] = [];
  let total = 0;
  let beforeBlock: number | undefined;

  while (total < maxBars) {
    const page = await fetchBars({ ...p, countBack: MAX_BARS_PER_REQUEST, beforeBlock });
    if (page.length === 0) break;
    pages.unshift(page);
    total += page.length;
    if (page.length < MAX_BARS_PER_REQUEST) break;
    beforeBlock = page[0]!.blockNumberStart;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  const seen = new Set<number>();
  const bars = pages.flat().filter((b) => !seen.has(b.timestamp) && seen.add(b.timestamp));
  return bars.slice(-maxBars);
}

/** Same as fetchBarsHistory, but reuses a JSON cache file when present. */
export async function loadBarsHistory(p: FetchHistoryParams, cacheFile: string, refresh = false): Promise<Bar[]> {
  if (!refresh) {
    try {
      return JSON.parse(await readFile(cacheFile, "utf8")) as Bar[];
    } catch {
      // cache miss
    }
  }
  const bars = await fetchBarsHistory(p);
  if (bars.length === 0) throw new Error(`No bars returned for ${p.chain}/${p.dex}/${p.pairId}`);
  await mkdir(dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, JSON.stringify(bars));
  return bars;
}
