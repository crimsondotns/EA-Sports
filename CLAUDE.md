# EA-Sports

EA (automated trading) tooling for meme coins on DEX Screener: a Volume Breakout strategy, a backtester, an HTML chart report, and a Chrome extension that marks entries and exits on the DEX Screener chart.

## Layout

- `src/dexscreener/` — candle data from DEX Screener's unofficial chart endpoint (Avro-encoded; `bars.ts`, `avro.ts`), history paging (`history.ts`)
- `src/indicators.ts` — SMA / EMA / ATR / breakout high, `toCandles()`
- `src/strategy/volumeBreakout.ts` — the strategy; params in `DEFAULT_PARAMS`
- `src/backtest/engine.ts` — backtester (signal on bar close, fill at next open, fees + slippage, optional free ride)
- `src/report/html.ts` — HTML chart report (lightweight-charts)
- `src/cli/` — `bars`, `backtest`, `chart`, `compare` commands
- `src/pairs.ts` — named pairs for `--pair`
- `extension/` — Chrome extension (MV3). `src/background.ts` captures the chart's bars requests, `src/inject.ts` runs in the page (MAIN world) and draws via the TradingView API, `src/content.ts` runs the strategy and renders the side panel

## Commands

```bash
npm run typecheck                         # tsc --noEmit (src + extension)
npm run backtest -- 5 --pair solana --sweep
npm run chart -- 5 --pair robinhood       # writes data/report-*.html and opens it
npm run compare -- --pair robinhood       # scalping vs spot, with/without free ride
npm run ext:build                         # bundle extension into extension/dist
```

Node 24 runs the `.ts` files directly (type stripping), so code must use erasable TypeScript only (no enums, no parameter properties) and import local files with the `.ts` extension.

## Notes

- `io.dexscreener.com` / `feed.dexscreener.com` are unofficial and can change; `decodeBars()` refuses unknown format versions. With `mc=1` the USD fields are market cap.
- In the extension, the TradingView chart lives in an iframe that is rewritten with `document.open()`, which drops listeners added earlier; `inject.ts` re-attaches its message listener for that reason.
- The extension runs the strategy on the chart's own bars (`exportData`), so markers line up with the candles; the captured feed is a fallback and a source of volume.
- After changing the extension: `npm run ext:build`, reload it in `chrome://extensions`, then refresh the DEX Screener tab.

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
- Follow the spec's implementation rules and definition of done, and only report checks that were actually run.

The extension icon (`extension/icon.svg`, black and gold EA monogram) is the brand mark and is exempt from the no-gradient rule.

@docs/design-system.md
