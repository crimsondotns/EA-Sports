# EA-Sports

EA Drawing: a Chrome extension (MV3) that draws on the DEX Screener TradingView chart from the pair's daily bars: horizontal lines at ATH close −90% / −95%, a Fib retracement from the ATL (open of the lowest-close daily bar) to the ATH close, and an Anchored VWAP from the first bar.

## Layout

- `src/dexscreener/` — candle data from DEX Screener's unofficial chart endpoint (Avro-encoded; `bars.ts`, `avro.ts`, `checksum.ts`)
- `src/indicators.ts` — `Candle`, `toCandles()`
- `extension/` — the extension. `src/background.ts` captures the chart's bars requests and fetches the pair's daily bars (cached 15 min, 10 min cooldown after a failed request), `src/content.ts` works out the ATH / ATL / first bar and publishes a status for the popup, `src/inject.ts` runs in the page (MAIN world), reads the chart's last close (`exportData`) and creates the drawings via the TradingView API, `popup.html` / `src/popup.ts` show the status

## Commands

```bash
npm run typecheck                         # tsc --noEmit (src + extension)
npm run ext:build                         # bundle extension into extension/dist
npm run ext:zip                           # build + zip it for a GitHub release (extension/dist/release/)
```

Node 24 runs the `.ts` files directly (type stripping), so code must use erasable TypeScript only (no enums, no parameter properties) and import local files with the `.ts` extension.

## Notes

- `io.dexscreener.com` / `feed.dexscreener.com` are unofficial and can change; `decodeBars()` refuses unknown format versions. With `mc=1` the USD fields are market cap. EVM pair addresses must be in EIP-55 checksum case or the endpoint returns no bars (`fetchBars` converts them).
- In the extension, the TradingView chart lives in an iframe that is rewritten with `document.open()`, which drops listeners added earlier; `inject.ts` re-attaches its message listener for that reason.
- The chart's own last close picks the price field (USD or quote, price or market cap) the daily bars are read in; the captured feed's last close is the fallback.
- **EA Drawing (branch `Drawing`): never draw over an existing drawing.** Its lines (ATH −90% / −95% from the daily ATH close, the Fib retracement from the ATL to the ATH, the Anchored VWAP from the first bar) are real drawings saved with the chart layout. Before creating one, read the chart's shapes (`getAllShapes` / `getShapeById().getPoints()`) and skip it when the same kind already exists at that place: a horizontal line within 0.5% of the price, a Fib retracement with both ends within 0.5%, any Anchored VWAP. Never remove, move or restyle drawings already on the chart (the user's or ours); every new drawing tool follows the same check.
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
- Tooltips: one short line in a pill (project override): `#303030` surface, no border, 999px radius, white 12px / 16px text, 4px × 10px padding, never wraps; keep the text to a few words. Open after ~500ms hover, promptly on keyboard focus, close after 100ms; prefer top placement and flip to stay in view. `role="tooltip"` + `aria-describedby`, never interactive, never the only place essential info or a label lives.
- Dropdowns / pickers: panel `#171717` with **no border** (project override of the spec; the shadow and the lighter surface separate it), shadow `0 8px 24px rgb(0 0 0 / 32%)`, 4px padding, rows 36–40px with 6px radius. Row hover `#202020`, selected `#262626` plus a checkmark, selected + hover `#303030`, pressed `#2A2A2A`. Trigger border `#2A2A2A`, hover `#444444` on `#111111`. Open on click (never hover alone); Escape closes and refocuses the trigger.
- Hover is neutral and fast (120–160ms), never scales or shifts layout; pointer-only polish goes under `@media (hover: hover) and (pointer: fine)`.
- Follow the spec's implementation rules and definition of done, and only report checks that were actually run.

The extension icon (`extension/icon.svg`, the Eagle Analytics mark traced to SVG, white on a black rounded square) is the brand mark. `icon128/48.png` are rendered from it; `icon32/16.png` from a version with thicker lines so they stay legible.

@docs/design-system.md
