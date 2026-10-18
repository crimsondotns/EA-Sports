// Usage: npm run bars -- [resolution] [countBack]
import { fetchBars, type Resolution } from "../dexscreener/bars.ts";

const [res = "1440", cb = "500"] = process.argv.slice(2);

const bars = await fetchBars({
  dex: "solamm",
  chain: "solana",
  pairId: "7yMhxapzceFUo24KNgP77mGj1crdAv8ayYfqGvB5skZf",
  quoteToken: "So11111111111111111111111111111111111111112",
  resolution: Number(res) as Resolution,
  countBack: Number(cb),
});

console.log(`${bars.length} bars`);
console.table(
  bars.slice(-10).map((b) => ({
    time: new Date(b.timestamp).toISOString().replace(".000Z", "Z"),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    closeUsd: b.closeUsd,
    volumeUsd: b.volumeUsd,
  })),
);
