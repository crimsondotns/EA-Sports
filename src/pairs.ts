export interface PairConfig {
  dex: string;
  chain: string;
  pairId: string;
  quoteToken: string;
}

export const PAIRS = {
  robinhood: {
    dex: "uniswapv4",
    chain: "robinhood",
    pairId: "0x6ff5c44dbae70efd0c5124979b803395163c8e93e7d1f97a7fcdeb1ed875f5c2",
    quoteToken: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  },
  base: {
    dex: "uniswap",
    chain: "base",
    pairId: "0x4b0aaf3ebb163dd45f663b38b6d93f6093ebc2d3",
    quoteToken: "0x4200000000000000000000000000000000000006",
  },
  solana: {
    dex: "solamm",
    chain: "solana",
    pairId: "7yMhxapzceFUo24KNgP77mGj1crdAv8ayYfqGvB5skZf",
    quoteToken: "So11111111111111111111111111111111111111112",
  },
} satisfies Record<string, PairConfig>;

/** Reads `--pair <name>` from CLI args (default: robinhood). */
export function pairFromArgs(args: string[]): { name: string; pair: PairConfig } {
  const i = args.indexOf("--pair");
  const name = i >= 0 ? args[i + 1] ?? "" : "robinhood";
  const pair = (PAIRS as Record<string, PairConfig>)[name];
  if (!pair) throw new Error(`Unknown pair "${name}". Available: ${Object.keys(PAIRS).join(", ")}`);
  return { name, pair };
}

/** First positional arg that isn't a flag or a flag's value. */
export function positionalArg(args: string[]): string | undefined {
  return args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--pair" && args[i - 1] !== "--free");
}
