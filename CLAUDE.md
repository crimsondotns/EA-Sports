# EA-Sports

EA (automated trading) tooling for meme coins on DEX Screener: a Volume Breakout strategy, a backtester, an HTML chart report, and a Chrome extension that marks entries and exits on the DEX Screener chart.

## Layout

- `src/dexscreener/` — candle data from DEX Screener's unofficial chart endpoint (Avro-encoded; `bars.ts`, `avro.ts`), history paging (`history.ts`)
- `src/indicators.ts` — SMA / EMA / ATR / breakout high, `toCandles()`
- `src/strategy/` — `volumeBreakout.ts`, `quietAccumulation.ts` (S/R + reversal), `emaMacdRsi.ts` (Deep Dip, and New Launch = the same at 5% size for a pair's first week on 5m: at a support if one exists below, under EMA 9/21/200, MACD & signal below the histogram, RSI 30–60; EMA 200 skipped until it exists)
- `docs/strategies.md` — every preset's entry rules, trade management, backtest results and confirm point (Thai)
- `src/universe.txt` — pairs for the multi-coin test (DEX Screener export rows: chain, dex, quote, base, pair)
- `src/backtest/engine.ts` — backtester (signal on bar close, fill at next open, fees + slippage, optional free ride)
- `src/report/html.ts` — HTML chart report (lightweight-charts)
- `src/cli/` — `bars`, `backtest`, `chart`, `compare` commands
- `src/pairs.ts` — named pairs for `--pair`
- `extension/` — Chrome extension (MV3). `src/background.ts` captures the chart's bars requests, `src/inject.ts` runs in the page (MAIN world) and draws signals and adds each strategy's indicators (`studies` in `strategies.ts`) via the TradingView API, `src/content.ts` runs the strategy and renders the side panel

## Commands

```bash
npm run typecheck                         # tsc --noEmit (src + extension)
npm run backtest -- 5 --pair solana --sweep
npm run chart -- 5 --pair robinhood       # writes data/report-*.html and opens it
npm run compare -- --pair robinhood       # scalping vs spot, with/without free ride
npm run universe -- --detail              # every strategy on every pair in src/universe.txt
npm run ext:build                         # bundle extension into extension/dist
```

Node 24 runs the `.ts` files directly (type stripping), so code must use erasable TypeScript only (no enums, no parameter properties) and import local files with the `.ts` extension.

## Notes

- `io.dexscreener.com` / `feed.dexscreener.com` are unofficial and can change; `decodeBars()` refuses unknown format versions. With `mc=1` the USD fields are market cap. EVM pair addresses must be in EIP-55 checksum case or the endpoint returns no bars (`fetchBars` converts them).
- In the extension, the TradingView chart lives in an iframe that is rewritten with `document.open()`, which drops listeners added earlier; `inject.ts` re-attaches its message listener for that reason.
- The extension runs the strategy on the chart's own bars (`exportData`), so markers line up with the candles; the captured feed is a fallback, a source of volume, and older history: `background.ts` pages back up to 4 requests (~31 days, cached 15 min) and `content.ts` prepends those bars in whichever price field matches the chart. `analyze()` starts every run at the same point (midnight UTC, ~31 days plus warm-up back), because trades are path dependent and the chart's loaded range changes when the user scrolls.
- After changing the extension: `npm run ext:build`, reload it in `chrome://extensions`, then refresh the DEX Screener tab.

## Reporting strategy work

- **Every time a strategy change or strategy test is finished, explain the confirm points** for both entry and exit in the reply: the exact bar on which the entry is confirmed, which conditions must all be true on that bar's close (and any that may already have happened earlier, such as the support test), when the order fills (the next bar's open), and where the stop, cost back and exits sit. Use a concrete example (prices or a chart moment) when one is available.
- Say which rules are on in the shipped preset and which were only tested.
- **When a strategy's rules, sizing, exits or preset defaults change, update `docs/strategies.md` in the same commit**: the conditions, the trade-management table, the exit rules (when each exit triggers and at what price), the backtest line, the entry and exit confirm points and their examples. Keep its format.

## Git workflow

- **Commit after every finished task.** When a change is done and its checks pass (`npm run typecheck`, plus `npm run ext:build` for extension changes), commit it right away. Don't wait to be asked, and don't leave finished work uncommitted.
- One commit per task, with a short message that says what changed and why. Stage files explicitly; never commit `node_modules/`, `data/` or `extension/dist/`.
- If checks fail, fix them first. If the task is left unfinished, say so instead of committing broken work.
- Committing is local only: push or open a PR only when asked.

## UI design system

All UI in this project (extension panel, HTML reports, any future pages) follows the dark design system in `docs/design-system.md`. Key rules:

- Page background `#000000`; surfaces `#0A0A0A` / `#171717`; borders `#2A2A2A`.
- Primary button: white background, black text. Secondary: `#1A1A1A` with white text. One primary action per group.
- System sans-serif font stack, 4px spacing grid, tabular numerals for prices and figures.
- No decorative gradients, glows or bright accents. Color only where it carries meaning: in this project that means trading semantics (buy / sell, profit / loss, stop) and success / warning / danger states.
- Every interactive control has hover, focus-visible, active and disabled states; respect `prefers-reduced-motion`.
- Tooltips: one short line in a pill (project override): `#303030` surface, no border, 999px radius, white 12px / 16px text, 4px × 10px padding, never wraps; keep the text to a few words. Open after ~500ms hover, promptly on keyboard focus, close after 100ms; prefer top placement and flip to stay in view. `role="tooltip"` + `aria-describedby`, never interactive, never the only place essential info or a label lives.
- Dropdowns / pickers: panel `#171717` with **no border** (project override of the spec; the shadow and the lighter surface separate it), shadow `0 8px 24px rgb(0 0 0 / 32%)`, 4px padding, rows 36–40px with 6px radius. Row hover `#202020`, selected `#262626` plus a checkmark, selected + hover `#303030`, pressed `#2A2A2A`. Trigger border `#2A2A2A`, hover `#444444` on `#111111`. Open on click (never hover alone); Escape closes and refocuses the trigger.
- Hover is neutral and fast (120–160ms), never scales or shifts layout; pointer-only polish goes under `@media (hover: hover) and (pointer: fine)`.
- Follow the spec's implementation rules and definition of done, and only report checks that were actually run.

The extension icon (`extension/icon.svg`, black and gold EA monogram) is the brand mark and is exempt from the no-gradient rule.

@docs/design-system.md
