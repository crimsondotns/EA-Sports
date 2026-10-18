import { AvroReader } from "./avro.ts";

// Unofficial endpoint used by the dexscreener.com chart. It can change without notice.
const BASE_URL = "https://io.dexscreener.com/dex/chart/amm/v3";
const SUPPORTED_VERSION = "1.0.0";

export type Resolution = 1 | 5 | 15 | 60 | 240 | 720 | 1440;

export interface Bar {
  /** Bar open time, ms since epoch (UTC). */
  timestamp: number;
  /** Prices in quote token, kept as strings to avoid precision loss. */
  open: string;
  high: string;
  low: string;
  close: string;
  openUsd: string | null;
  highUsd: string | null;
  lowUsd: string | null;
  closeUsd: string | null;
  volumeUsd: string | null;
  /** Meaning not confirmed; looks like a block number. */
  blockNumberStart: number;
  blockNumberEnd: number;
}

export interface FetchBarsParams {
  dex: string; // e.g. "uniswapv4"
  chain: string; // e.g. "robinhood"
  pairId: string; // pair address, or PoolId for Uniswap v4
  quoteToken: string;
  resolution: Resolution;
  countBack?: number;
  /** Only return bars before this block (paging). */
  beforeBlock?: number;
  signal?: AbortSignal;
}

export class UnsupportedFormatError extends Error {}

export function decodeBars(bytes: Uint8Array): Bar[] {
  const r = new AvroReader(bytes);
  const version = r.string();
  if (version !== SUPPORTED_VERSION) {
    throw new UnsupportedFormatError(`Unsupported bars format version "${version}"`);
  }
  // Union [null, array<Bar>]
  if (r.long() === 0) return [];

  const bars: Bar[] = [];
  while (!r.done) {
    let count = r.long();
    if (count === 0) break;
    if (count < 0) {
      count = -count;
      r.long(); // block byte size
    }
    for (let i = 0; i < count; i++) {
      bars.push({
        timestamp: r.double(),
        open: r.string(),
        openUsd: r.optionalString(),
        high: r.string(),
        highUsd: r.optionalString(),
        low: r.string(),
        lowUsd: r.optionalString(),
        close: r.string(),
        closeUsd: r.optionalString(),
        volumeUsd: r.optionalString(),
        blockNumberStart: r.double(),
        blockNumberEnd: r.double(),
      });
    }
  }
  return bars;
}

export async function fetchBars(p: FetchBarsParams): Promise<Bar[]> {
  const url = new URL(`${BASE_URL}/${p.dex}/bars/${p.chain}/${p.pairId}`);
  url.searchParams.set("bbn", p.beforeBlock === undefined ? "" : String(p.beforeBlock));
  url.searchParams.set("res", String(p.resolution));
  url.searchParams.set("cb", String(p.countBack ?? 500));
  url.searchParams.set("q", p.quoteToken);

  const res = await fetch(url, {
    signal: p.signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      Origin: "https://dexscreener.com",
      Referer: "https://dexscreener.com/",
    },
  });
  if (!res.ok) {
    throw new Error(`DEX Screener bars request failed: HTTP ${res.status}`);
  }
  return decodeBars(new Uint8Array(await res.arrayBuffer()));
}
