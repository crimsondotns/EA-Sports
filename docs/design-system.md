# ChatGPT-Inspired Design System — Dark Canvas, White Buttons

> A practical UI design specification for AI coding agents. Use a restrained, minimal interface inspired by ChatGPT's clean conversational experience. This is a custom project specification, not an official OpenAI design-system document.

## 0. Project overrides (EA Signals)

- **Light theme:** besides the dark default, the extension has a light theme the user can switch to. It keeps every token role below and swaps the values: background `#F5F6F8`, surfaces `#FFFFFF`, borders `#E3E6EB`, primary text `#14161A`, secondary `#5A606B`, primary button `#14161A` with white text, success `#0E9F6E`, danger `#D92D20`, warning `#B54708`.
- **Typeface:** Manrope (bundled variable font) replaces the system stack as the first choice; the system stack stays as the fallback.
- **Buttons (Grok-style):** every text button is a full pill. Primary: white / black text (light theme: ink / white), pressed `#D7DBDC`, disabled `#272A2E` with `#71767B` text. Secondary: transparent with a `1px #2F3336` hairline, hover `#16181C`, pressed `#272A2E`. Press gives a short `scale(.96)` (110ms), removed under reduced motion.
- **Dropdown panels (Grok frosted glass):** replaces the solid `#171717` panel below. Tint `rgb(22 24 28 / 78%)` (light: white 78%), `blur(24px) saturate(140%)`, `1px` hairline `rgb(255 255 255 / 10%)`, radius 16px, padding 6px, shadow `0 12px 40px rgb(0 0 0 / 45%)`. Rows 40px, radius 10px: hover white 7%, pressed 10%, selected 12% plus the check. Opens with a 160ms scale(.96)→1 ease-out (fade only under reduced motion); solid `#1E2126` under reduced transparency.
- **Layout:** design G (`design/redesign/g-gate-themes.html`) is the reference for the popup and the on-chart pill.

## 1. Design Principles

- **Dark by default:** use near-black surfaces as the foundation.
- **White primary actions:** primary buttons are white with dark text.
- **Quiet hierarchy:** prioritize readable text, spacing, and alignment over decoration.
- **Minimal chrome:** avoid unnecessary borders, shadows, gradients, and colorful cards.
- **Consistent behavior:** controls must have predictable hover, focus, pressed, disabled, and loading states.
- **Accessible contrast:** maintain readable contrast and visible keyboard focus.

## 2. Color Tokens

Use semantic tokens rather than hard-coding colors throughout components.

| Token | Value | Usage |
|---|---|---|
| `--color-bg` | `#000000` | Main app background |
| `--color-surface` | `#0A0A0A` | Standard surface / panel |
| `--color-surface-elevated` | `#171717` | Menus, popovers, elevated panels |
| `--color-surface-hover` | `#202020` | Hovered dark surfaces |
| `--color-text-primary` | `#FFFFFF` | Headings and primary content |
| `--color-text-secondary` | `#B4B4B4` | Supporting text |
| `--color-text-muted` | `#777777` | Placeholders and low-emphasis metadata |
| `--color-border` | `#2A2A2A` | Default separators and borders |
| `--color-border-strong` | `#444444` | Emphasized borders |
| `--color-button-primary-bg` | `#FFFFFF` | Primary button background |
| `--color-button-primary-text` | `#000000` | Primary button label |
| `--color-button-primary-hover` | `#EAEAEA` | Primary button hover background |
| `--color-button-primary-pressed` | `#D6D6D6` | Primary button pressed background |
| `--color-button-secondary-bg` | `#1A1A1A` | Secondary button background |
| `--color-button-secondary-text` | `#FFFFFF` | Secondary button label |
| `--color-button-secondary-hover` | `#262626` | Secondary button hover background |
| `--color-focus` | `#FFFFFF` | Focus ring; pair with a dark offset where needed |
| `--color-danger` | `#F87171` | Destructive actions and errors |
| `--color-success` | `#4ADE80` | Success indicators |
| `--color-warning` | `#FBBF24` | Warnings |

### Color Rules

- The main page background must be black (`#000000`). Do not replace it with a light page background.
- **Primary buttons must be white with black text.** This is the default for the most important action in a view.
- Secondary buttons should be dark with white text and a subtle border when necessary.
- Destructive actions may use a danger color, but should not compete visually with the primary action unless the destructive action is the main task.
- Use status colors only when they communicate meaning. Do not add bright accent colors for decoration.
- Keep surfaces visually close to black; use small luminance differences to establish hierarchy.

## 3. Typography

Use a clean system sans-serif stack. Avoid decorative fonts.

```css
font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
  "Segoe UI", sans-serif;
```

| Style | Size | Weight | Line height | Usage |
|---|---:|---:|---:|---|
| Display | `32–40px` | `600` | `1.15` | Rare, top-level landing heading |
| H1 | `28–32px` | `600` | `1.2` | Page title |
| H2 | `22–24px` | `600` | `1.3` | Main section heading |
| H3 | `18–20px` | `600` | `1.35` | Subsection heading |
| Body | `14–16px` | `400` | `1.5` | Main interface copy |
| Small | `12–13px` | `400` | `1.45` | Supporting labels and metadata |
| Button | `14px` | `500–600` | `1.2` | Button labels |
| Code | `13–14px` | `400` | `1.5` | Code and technical values |

### Typography Rules

- Use white for primary text and muted gray for supporting information.
- Keep headings concise and avoid overly heavy font weights.
- Do not use uppercase text for entire labels unless required for a compact technical badge.
- Use tabular numerals for prices, IDs, balances, and other values that need column alignment.
- Body text should remain comfortable to read; do not shrink essential content to fit a layout.

## 4. Spacing and Layout

Use a consistent 4px spacing grid.

| Token | Value | Typical usage |
|---|---:|---|
| `space-1` | `4px` | Icon-to-label gap, tiny offsets |
| `space-2` | `8px` | Compact control gaps |
| `space-3` | `12px` | Tight component spacing |
| `space-4` | `16px` | Standard internal spacing |
| `space-5` | `20px` | Related groups |
| `space-6` | `24px` | Card and section spacing |
| `space-8` | `32px` | Major section gaps |
| `space-10` | `40px` | Large layout separation |
| `space-12` | `48px` | Page-level vertical rhythm |
| `space-16` | `64px` | Large empty-space regions |

### Layout Rules

- Align content to a clear grid and maintain consistent horizontal edges.
- Prefer whitespace over extra divider lines.
- Use a comfortable content width; avoid stretching long text across very wide screens.
- On small screens, reduce outer page padding without compressing controls or text.
- Group related controls together and separate unrelated sections clearly.
- Avoid stacking too many nested cards. Use a simple page background with only the surfaces needed for hierarchy.

## 5. Buttons

### Primary Button

Use for the most important action in a section or dialog.

- Background: `#FFFFFF`
- Text: `#000000`
- Border: none, unless a border is needed for consistent geometry
- Border radius: `999px` for pill-shaped actions or `10–12px` for compact application controls; choose one style per product and remain consistent
- Height: `40px` standard, `44–48px` for prominent actions
- Horizontal padding: `16–20px`
- Font size: `14px`
- Font weight: `600`
- Hover: `#EAEAEA`
- Pressed: `#D6D6D6`
- Disabled: muted light gray background with dark gray text; clearly indicate that the control is unavailable

### Secondary Button

- Background: `#1A1A1A`
- Text: `#FFFFFF`
- Border: `1px solid #333333` when needed
- Hover: `#262626`
- Pressed: `#303030`

### Tertiary / Ghost Button

- Background: transparent
- Text: `#E5E5E5`
- Border: transparent
- Hover: `#1F1F1F`
- Use for low-emphasis actions, icon buttons, and inline controls.

### Destructive Button

- Use a restrained red treatment for destructive actions.
- For irreversible actions, make the consequence clear and require confirmation when appropriate.
- Do not style every cancel or secondary action as destructive.

### Button Interaction Rules

- Every interactive button must have hover, focus-visible, pressed, disabled, and (when applicable) loading states.
- Use a visible focus ring for keyboard navigation.
- Keep labels action-oriented: “Save changes”, “Connect source”, “Sign out”.
- Do not use a white primary button for every action in the same group. Reserve it for the most important action.
- Icon-only buttons must have an accessible name and a clear tooltip where useful.

## 6. Form Controls

### Text Inputs and Textareas

- Background: `#0A0A0A` or `#141414`
- Text: `#FFFFFF`
- Placeholder: `#777777`
- Border: `1px solid #333333`
- Border radius: `10–12px`
- Height: `40–44px` for single-line inputs
- Horizontal padding: `12–14px`
- Hover border: `#555555`
- Focus border: `#888888` with a visible focus ring
- Error border and message: use the danger token, and explain how to resolve the error

Always provide a persistent label for important inputs. Do not rely on placeholder text as the only label.

### Checkboxes, Radios, and Switches

- Use white for the selected indicator against a dark control surface.
- Make the full label area clickable where practical.
- Provide a visible keyboard focus state.
- Do not communicate a setting only through color; include a label or state indicator.

## 7. Cards, Panels, and Dialogs

### Cards and Panels

- Default to no visible card border unless separation is needed.
- Use `#0A0A0A` or `#111111` for panel surfaces on a black page.
- Use `#2A2A2A` for subtle borders and separators.
- Use `16–24px` internal padding depending on density.
- Avoid heavy shadows, glass effects, gradients, and excessive rounded containers.

### Dialogs

- Use a dark surface (`#111111` or `#171717`) against a black page.
- Use a subtle border (`#303030`) and restrained shadow only if needed to distinguish the dialog.
- Clearly separate the title, content, and action area through spacing rather than decorative lines.
- Keep the action order consistent. For confirmation dialogs, place the safer action (Cancel) as secondary and the confirming action as primary, unless the action is destructive; destructive confirmation must be visually explicit.
- Close dialogs with Escape only when safe and expected. Preserve form state when appropriate.
- Keep dialogs responsive and ensure their content fits on smaller screens.

## 8. Navigation and Icons

- Use white or light gray for active navigation items.
- Use muted gray for inactive items and a dark surface for hover states.
- Keep icons simple, consistent in stroke weight, and typically `16–20px`.
- Use one icon family throughout the application.
- Do not use emoji as a replacement for core interface icons.
- Active states should include more than color where useful, such as a background, indicator, or font-weight change.

## 9. Borders, Radius, and Elevation

- Default border: `1px solid #2A2A2A`.
- Stronger border: `1px solid #444444`.
- Small control radius: `8–10px`.
- Standard input/dialog radius: `10–14px`.
- Large panel radius: `14–18px`.
- Pill radius: `999px`.
- Use shadows sparingly. Separate layers primarily with background tone, spacing, and a subtle border.
- Do not mix many different radius styles in one interface.

## 10. Motion and Feedback

- Use short transitions, generally `120–180ms`.
- Animate opacity, background color, border color, or small positional changes only when it improves clarity.
- Avoid bouncing, exaggerated scaling, and ornamental animation.
- Respect `prefers-reduced-motion`.
- Provide clear feedback for save, copy, connect, disconnect, and delete actions.
- Loading states must prevent duplicate submissions when necessary and explain the ongoing action.
- Errors should state what happened and provide a useful next step.

## 11. Accessibility

- Maintain strong text contrast on all dark surfaces.
- Ensure every interactive element is keyboard accessible.
- Use `:focus-visible` styles that are visible on both black and elevated dark surfaces.
- Do not remove outlines without adding an equivalent focus indicator.
- Give inputs accessible names and associate errors with the relevant field.
- Use semantic HTML elements and correct heading order.
- Support zoom and narrow screens without clipping essential content.
- Do not use color as the only indication of status, validation, selection, or danger.
- Meet WCAG contrast targets where applicable, and verify actual token combinations in the finished UI.

## 12. Responsive Behavior

- Design mobile-first and verify narrow layouts as well as wide desktop layouts.
- Allow button groups and form fields to wrap or stack on narrow screens.
- Keep primary actions easy to locate and tap.
- Do not require hover to reveal essential information or actions.
- Use full-width primary actions on mobile when this improves usability.
- Prevent dialogs, menus, and popovers from extending beyond the viewport.

## 13. Example CSS Tokens

```css
:root {
  color-scheme: dark;

  --color-bg: #000000;
  --color-surface: #0A0A0A;
  --color-surface-elevated: #171717;
  --color-surface-hover: #202020;

  --color-text-primary: #FFFFFF;
  --color-text-secondary: #B4B4B4;
  --color-text-muted: #777777;

  --color-border: #2A2A2A;
  --color-border-strong: #444444;

  --color-button-primary-bg: #FFFFFF;
  --color-button-primary-text: #000000;
  --color-button-primary-hover: #EAEAEA;
  --color-button-primary-pressed: #D6D6D6;

  --color-button-secondary-bg: #1A1A1A;
  --color-button-secondary-text: #FFFFFF;
  --color-button-secondary-hover: #262626;

  --color-danger: #F87171;
  --color-success: #4ADE80;
  --color-warning: #FBBF24;

  --radius-control: 10px;
  --radius-panel: 16px;
  --radius-pill: 999px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  --transition-fast: 140ms ease;
}

html,
body {
  background: var(--color-bg);
  color: var(--color-text-primary);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", sans-serif;
}

.button-primary {
  min-height: 40px;
  padding: 0 18px;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: var(--color-button-primary-bg);
  color: var(--color-button-primary-text);
  font-size: 14px;
  font-weight: 600;
  transition:
    background-color var(--transition-fast),
    transform var(--transition-fast);
}

.button-primary:hover:not(:disabled) {
  background: var(--color-button-primary-hover);
}

.button-primary:active:not(:disabled) {
  background: var(--color-button-primary-pressed);
}

.button-primary:focus-visible {
  outline: 2px solid var(--color-focus, #FFFFFF);
  outline-offset: 3px;
}

.button-primary:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.button-secondary {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  background: var(--color-button-secondary-bg);
  color: var(--color-button-secondary-text);
  transition: background-color var(--transition-fast);
}

.button-secondary:hover:not(:disabled) {
  background: var(--color-button-secondary-hover);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 14. Tooltip Design System

Tooltips must follow the companion specification in `chatgpt-inspired-tooltip-design-system.md`. Reuse the application's shared tooltip primitive rather than creating one-off implementations.

### Core Rules

- Surface: `#303030`; text: `#FFFFFF`; no border; radius: `999px` (pill). Project override of the companion spec.
- Typography: `12px` with a `16px` line height; one short line only (a few words), never wrapping.
- Padding: `4px 10px`; width fits the text, kept inside the viewport.
- Show after approximately `500ms` of hover; show promptly on keyboard focus; close after a short `100ms` exit delay.
- Prefer top placement, but flip/shift based on available viewport space. Prevent clipping inside dialogs, sidebars, and scroll containers.
- Provide `role="tooltip"`, a stable ID, and an `aria-describedby` relationship. The trigger must still have its own accessible name.
- Tooltips are non-interactive. Use a popover for links, buttons, forms, or longer help content.
- Never put essential instructions or the only accessible label in a hover-only tooltip. Provide a touch-friendly alternative when needed.
- Respect `prefers-reduced-motion`; use only a subtle fade and 2px movement.

See `chatgpt-inspired-tooltip-design-system.md` for the complete token table, behavior, placement, accessibility, CSS reference, and implementation checklist.

## 15. AI Coding Agent Implementation Rules

When implementing or redesigning a page, component, or dialog:

1. **Read the existing project first.** Identify the framework, styling system, existing components, and current design tokens.
2. **Reuse before replacing.** Extend existing shared components and tokens instead of introducing duplicate button, input, dialog, or color systems.
3. **Apply this specification consistently.** The page background is black and the primary button is white with black text.
4. **Preserve functionality.** Do not remove existing validation, keyboard behavior, loading states, analytics, routes, or data handling while changing the appearance.
5. **Cover interaction states.** Implement hover, focus-visible, active, disabled, loading, error, and success states as applicable.
6. **Handle responsive layouts.** Check desktop and mobile widths; prevent overflow and clipped dialogs.
7. **Avoid arbitrary styling.** Use design tokens and the established spacing scale. Do not add gradients, bright accent colors, or heavy shadows without a clear functional reason.
8. **Verify the result.** Run available lint, type-check, tests, and build commands. Fix regressions introduced by the change.
9. **Report the work clearly.** Summarize changed files, behavior preserved, checks run, and any remaining limitations.
10. **Do not fake verification.** Report a check as passed only if it was actually run and succeeded.

## 16. Definition of Done

- [ ] Main application background is black (`#000000`).
- [ ] Primary buttons are white with black labels.
- [ ] Secondary and ghost buttons use the defined dark treatments.
- [ ] Typography and spacing follow the design tokens.
- [ ] Hover, focus-visible, active, disabled, and loading states are implemented where applicable.
- [ ] Dialogs and forms work on mobile and desktop.
- [ ] Keyboard accessibility and visible focus styles are preserved.
- [ ] Tooltips follow the shared dark-theme tooltip specification and work on hover, keyboard focus, and touch alternatives.
- [ ] Tooltips use accessible names/description wiring and do not contain interactive content.
- [ ] Existing product behavior has not been unintentionally removed.
- [ ] Available project checks have been run and their actual results reported.

---

# Appendix: Dropdown, Picker & Hover System

## Dropdown, Picker & Hover System

> A practical UI specification for AI coding agents. Designed for a black canvas, white primary actions, quiet neutral surfaces, and predictable interactions. This is a custom project specification inspired by a restrained conversational UI; it is not an official OpenAI design-system document.

### 1. Purpose and Principles

Use this specification for dropdown menus, select controls, searchable pickers, multi-select pickers, command menus, list-item interactions, and hover states across the application.

- **Dark by default:** the application canvas remains black (`#000000`).
- **White primary actions:** the most important action uses a white background and black text.
- **Neutral interaction states:** hover and selection should use subtle gray surfaces, not bright accent colors.
- **Clear selection:** the current value and selected options must be easy to identify without relying on color alone.
- **Predictable behavior:** pointer, keyboard, touch, focus, open, selected, disabled, and error states must be consistent.
- **Accessible by design:** support keyboard operation, visible focus, screen readers, sufficient contrast, and reduced motion.
- **Use the right component:** use a tooltip for brief non-interactive help, a dropdown for a short action list, a select for choosing a value, and a popover/dialog for richer interactive content.

### 2. Color Tokens

Use semantic CSS variables. Do not scatter raw color values across individual components.

| Token | Value | Usage |
|---|---|---|
| `--color-bg` | `#000000` | Main application background |
| `--color-surface` | `#0A0A0A` | Default panel or inset region |
| `--color-surface-elevated` | `#171717` | Dropdowns, menus, popovers, picker panels |
| `--color-surface-hover` | `#202020` | Hovered menu rows and neutral interactive surfaces |
| `--color-surface-pressed` | `#2A2A2A` | Pressed or actively clicked neutral surfaces |
| `--color-surface-selected` | `#262626` | Selected option background |
| `--color-text-primary` | `#FFFFFF` | Primary text |
| `--color-text-secondary` | `#B4B4B4` | Supporting labels and descriptions |
| `--color-text-muted` | `#777777` | Placeholder or low-emphasis metadata only |
| `--color-text-disabled` | `#666666` | Disabled labels |
| `--color-border` | `#2A2A2A` | Default border and separators |
| `--color-border-strong` | `#444444` | Hovered or emphasized control border |
| `--color-focus` | `#FFFFFF` | Keyboard focus ring |
| `--color-button-primary-bg` | `#FFFFFF` | Primary action background |
| `--color-button-primary-text` | `#000000` | Primary action label |
| `--color-button-primary-hover` | `#EAEAEA` | Primary action hover |
| `--color-danger` | `#F87171` | Error and destructive states |

#### Color rules

- Do not change the black canvas to gray just to make a dropdown stand out. Use an elevated surface, subtle border, and restrained shadow.
- Dropdown and picker panels use `#171717` by default; menu-row hover uses `#202020`.
- Selected options use a neutral selected surface plus a checkmark, radio indicator, checkbox, or other explicit state indicator.
- Do not use white text on the white primary button. Primary button text must be black.
- Reserve red for errors/destructive actions and status colors for meaningful states. Do not decorate options with arbitrary accent colors.
- A hover state must remain distinguishable from keyboard focus and selected state.

### 3. Typography

Use the same system font stack as the main design system:

```css
font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
  "Segoe UI", sans-serif;
```

| Element | Font size | Weight | Line height |
|---|---:|---:|---:|
| Field label | `13–14px` | `500` | `1.4` |
| Select trigger value | `14px` | `400` | `1.4` |
| Dropdown option | `14px` | `400` | `1.4` |
| Option description | `12–13px` | `400` | `1.4` |
| Group heading | `11–12px` | `600` | `1.3` |
| Helper / error text | `12–13px` | `400` | `1.4` |

Rules:

- Keep option labels concise and sentence case.
- Use a secondary text token for descriptions, shortcuts, and metadata.
- Do not reduce essential labels below `12px` to fit long content.
- Use tabular numerals for amounts, IDs, and values that need to align.

### 4. Component Selection: Which Pattern to Use

| Pattern | Use it when | Expected behavior |
|---|---|---|
| Dropdown menu | The user chooses an action, such as Edit, Duplicate, or Delete | Opens a menu of actions; choosing an action performs it and closes the menu |
| Single-select picker | The user chooses one value from a list | Shows the current value; choosing an option updates the value and closes the panel |
| Searchable picker / combobox | The list is long or users may not know the exact label | Supports typing to filter options and clear empty/loading results |
| Multi-select picker | The user can choose more than one item | Uses checkboxes or equivalent indicators; selected values are clear; offers explicit Apply/Done when immediate commit would be disruptive |
| Command menu | The user searches for and runs app commands | Supports keyboard navigation, filtering, and clear shortcut hints |
| Date/time picker | The user chooses a date or time | Uses a dedicated calendar/time interaction with appropriate keyboard and localization behavior |
| Popover | The content includes controls, explanation, or more than a simple list | Can contain interactive content and must manage focus correctly |

Do not implement every pattern as a custom dropdown. Prefer the platform-native `<select>` when it meets the design and accessibility needs. For custom behavior, use an accessible component primitive or implement the full interaction model rather than styling a non-semantic `div` as a control.

### 5. Select Trigger Design

#### Default appearance

- Background: `#0A0A0A` or transparent against the black canvas.
- Text: `#FFFFFF` for a selected value; `#777777` for placeholder text.
- Border: `1px solid #2A2A2A`.
- Border radius: `10px` by default; use the application's established radius scale if one exists.
- Height: `40px` standard; `36px` compact only for dense interfaces; `44px` or larger for touch-first layouts.
- Horizontal padding: `12px`.
- Icon-label gap: `8px`.
- Chevron: `16px`, muted white/gray, aligned to the trailing edge.
- Field label sits above the trigger; helper/error copy sits below it.

#### Trigger states

| State | Visual behavior |
|---|---|
| Default | Transparent or `#0A0A0A` fill; subtle `#2A2A2A` border |
| Hover | Background may shift slightly toward `#111111`; border becomes `#444444` |
| Focus-visible | Clear `2px` white focus ring with a dark offset where needed; do not rely only on border color |
| Open | Keep focus styling; chevron may rotate `180deg` over `120–160ms` |
| Disabled | Muted text and icon, reduced emphasis, no hover treatment; expose the disabled state semantically |
| Invalid | Use `#F87171` border or error indicator and a linked error message; do not depend on red alone |
| Placeholder | Use muted text and preserve normal text contrast for actual selected values |

Rules:

- Keep the selected value visually distinct from placeholder text.
- Do not show a blinking caret in a non-searchable select trigger.
- Do not make the whole field look clickable when it is disabled.
- A visible label is preferred over placeholder-only labeling.
- For long selected values, truncate gracefully but provide an accessible full value; do not let the chevron shrink or overlap text.

### 6. Dropdown / Picker Panel

| Property | Default specification |
|---|---|
| Background | `#171717` |
| Text | `#FFFFFF` |
| Border | None (project override: the elevated surface and shadow separate the panel). Tooltips keep their `#383838` border. |
| Radius | `10px` or match the trigger radius |
| Shadow | `0 8px 24px rgb(0 0 0 / 32%)` |
| Width | Match trigger width by default; allow wider only when the content requires it |
| Minimum width | Never narrower than the trigger |
| Max height | `min(320px, 60vh)`; keep it inside the viewport |
| Panel padding | `4px` around option rows |
| Option row height | `36–40px`; aim for `44px` on touch-first layouts |
| Option horizontal padding | `10–12px` |
| Option corner radius | `6px` |
| Group gap | `4–8px` |
| Z-index | Use the shared overlay layer token; keep above local content but below modal dialogs |

#### Positioning

- Prefer below-start alignment for a field picker.
- Flip above the trigger when there is insufficient space below.
- Shift horizontally to remain within the viewport; never clip the panel off-screen.
- Keep a small gap (`4–6px`) between trigger and panel unless the component intentionally joins them visually.
- Anchor the panel to the trigger and avoid layout shift when opening.
- For scrollable panels, keep the trigger visible and ensure the selected option can scroll into view when appropriate.
- Recalculate placement on viewport resize, scroll, and content-size changes when using a custom overlay.

### 7. Option Row States

Every option row must have consistent hover, focus, selected, disabled, and pressed behavior.

| State | Background | Content / indicator |
|---|---|---|
| Default | Transparent | White primary label; optional gray description |
| Pointer hover | `#202020` | Text stays readable; no scale or bounce |
| Keyboard active | `#202020` plus visible focus/active distinction | Clear active row; maintain keyboard navigation context |
| Selected | `#262626` | Checkmark, radio, checkbox, or another explicit selected indicator |
| Selected + hover | Slightly stronger neutral surface, e.g. `#303030` | Keep selected indicator visible |
| Pressed | `#2A2A2A` | Brief pressed feedback |
| Disabled | Transparent | Muted text; no pointer-hover styling; cannot be selected |
| Destructive action | Neutral row by default; danger text/icon where useful | Confirm irreversible actions when required by product rules |

Rules:

- Hover does not mean selected. Do not show a checkmark only because the pointer is over an option.
- Selected state must remain visible after pointer movement.
- Disabled rows must not respond to click, Enter, Space, or type-to-select.
- Do not use an animation that shifts option labels horizontally or changes row dimensions on hover.
- If options have descriptions, align all labels and descriptions consistently.
- If options have icons, use one consistent icon size (`16px`) and a fixed icon column so labels align.
- Do not use color alone to communicate selection, errors, or disabled status.

### 8. Hover System Across the Application

Apply these rules consistently to interactive elements, not only dropdowns.

| Component | Hover behavior |
|---|---|
| Primary white button | Background `#EAEAEA`; text remains `#000000` |
| Secondary dark button | Background shifts toward `#262626`; retain white text |
| Text button / link | Increase text emphasis or show a subtle underline when appropriate; avoid bright neon color |
| Icon button | Neutral circular/square surface such as `#202020`; icon remains legible |
| Select trigger | Subtle background shift and border to `#444444` |
| Dropdown option | `#202020` row background |
| Selected option | Preserve selected indication; use a subtly stronger neutral surface on hover |
| Navigation item | `#171717` or `#202020` background; keep active/current page state distinct |
| Table row | Very subtle `#111111` surface only when row interaction is supported |
| Card / clickable tile | Subtle border/surface change; avoid large elevation jumps |
| Disabled element | No hover effect; cursor and semantics must reflect the disabled state |

#### Hover behavior rules

- Use `cursor: pointer` only for elements that are genuinely clickable. Use the default cursor for text and disabled controls.
- Use `120–160ms` transitions for color, border, and background changes. Avoid spring or bounce effects for everyday controls.
- Do not use `transform: scale()` as a default hover effect. Do not make buttons jump or shift the layout.
- Keep hover, active/pressed, selected, and focus-visible states independently testable.
- On touch devices, do not rely on hover to reveal required labels or actions.
- A hover effect must not reduce text contrast, hide an icon, or change the control's dimensions.
- Use `@media (hover: hover) and (pointer: fine)` for optional pointer-only hover polish; keyboard and touch interaction must still work without it.

### 9. Open / Close Interaction

| Interaction | Expected behavior |
|---|---|
| Click or tap trigger | Toggle panel open/closed |
| Click outside | Close the panel, unless an explicit multi-step interaction requires preserving it |
| Escape | Close the panel and return focus to the trigger |
| Choose a single option | Commit the value, close the panel, and return focus appropriately |
| Choose a multi-select option | Toggle that option without unexpectedly closing the picker |
| Enter | Activate the currently focused option or open the picker when the trigger is focused |
| Arrow keys | Move active option according to the component's documented keyboard pattern |
| Tab / Shift+Tab | Follow the page's normal focus order; do not trap focus in a simple dropdown |
| Type-to-select | Support incremental matching for simple, non-searchable lists where appropriate |
| Search input | Preserve typed query while navigating results; define a clear reset/close behavior |
| Scroll | Scroll the list without closing the menu or losing the active option |

Additional behavior:

- Open menus on explicit activation, not on hover alone. Hover-only dropdowns are fragile for keyboard users and touch devices.
- Avoid closing a panel when the pointer travels from its trigger into the panel; treat them as one interaction region.
- Close the panel on a committed single-select choice, Escape, or outside interaction.
- For destructive actions inside a menu, close the menu before opening a confirmation dialog where that creates a clearer focus flow.
- Preserve the last committed value if the user dismisses the picker without applying changes.
- Do not steal focus from a search input while filtering results.

### 10. Searchable Pickers and Multi-Select

#### Searchable picker

- Place the search field at the top of the panel, with a clear search icon only if it improves recognition.
- Search field height: `36–40px`; use `12px` horizontal padding.
- Filter options as the user types and keep keyboard navigation synchronized with the filtered results.
- Provide clear states for loading, no results, and an unavailable/error result.
- If a result count is shown, make it secondary metadata and keep it stable while the user navigates.
- Provide a clear button only when a non-empty query exists, and give it an accessible name.
- Do not claim that a search is fuzzy, remote, or case-insensitive unless the implementation actually behaves that way.

#### Multi-select picker

- Use checkboxes or a similarly explicit selection marker.
- Keep the panel open while toggling individual values.
- Show selected values in the trigger as a short summary (for example, “3 selected”) when a complete list would overflow.
- For complex or high-impact choices, provide explicit **Apply** and **Cancel** actions. Apply is the white primary button; Cancel is a dark secondary button.
- Make “Select all” and “Clear all” actions visually secondary to the actual options and scope them clearly to the current result set when searching.
- Announce selection changes to assistive technology when appropriate.
- Do not silently apply a partially edited selection when the user presses Escape if the component has explicit Apply/Cancel semantics.

### 11. Loading, Empty, Error, and Group States

- **Loading:** show concise text or a small spinner; avoid replacing the entire menu with a large skeleton. Keep the panel size stable when practical.
- **Empty list:** show a clear message such as “No options available.” Do not show a disabled-looking fake option that can be selected.
- **No search results:** say “No results found” and, when useful, suggest changing the query.
- **Error:** explain that options could not be loaded and provide Retry if retrying is supported.
- **Groups:** use muted, compact group headings with enough spacing to separate categories. Group headings are not selectable unless intentionally designed as actions.
- **Dividers:** use `#2A2A2A` sparingly; prefer spacing between groups where that preserves clarity.
- **Long labels:** wrap only when the pattern supports multiline rows; otherwise truncate and expose the full accessible name.
- **Large lists:** use virtualization only where needed, and preserve keyboard, screen-reader, and active-option behavior.

### 12. Motion and Reduced Motion

| Motion | Default |
|---|---|
| Panel open | `120–160ms` opacity and small `translateY(-2px → 0)` or `translateY(2px → 0)` |
| Panel close | `100–120ms` opacity fade |
| Chevron | `120–160ms` rotation |
| Hover color | `120–160ms` ease-out |
| Scale/bounce | Do not use by default |

- Use `prefers-reduced-motion: reduce` to remove non-essential movement and shorten or disable transitions.
- Avoid animating panel height from zero when the content causes layout jank; use a simple opacity/translate transition when appropriate.
- Do not delay opening a normal dropdown to create a hover-style effect. Activation should feel immediate.

### 13. Accessibility Requirements

- Prefer native `<select>` when it supports the required experience.
- Use semantic controls and established accessible primitives for custom listboxes, menus, and comboboxes.
- Select an ARIA pattern appropriate to the component: action menus are not listboxes, and a listbox is not a generic container for interactive buttons or checkboxes.
- Connect visible labels to form controls using `label` / `htmlFor` or the appropriate accessible naming API.
- Provide `aria-expanded` and `aria-controls` on custom triggers as appropriate, and use the correct role for the component pattern.
- Use `aria-selected`, `aria-checked`, `aria-disabled`, and active-descendant patterns only where appropriate for the chosen semantic pattern; do not add roles mechanically.
- Keep a visible `:focus-visible` indicator. Hover alone is not sufficient.
- Ensure arrow-key, Enter, Space, Escape, Home/End, and type-ahead behavior follows the selected ARIA interaction pattern.
- Keep focus order logical and avoid keyboard traps in non-modal dropdowns.
- Ensure target sizes are comfortable for touch; aim for a minimum `44 × 44px` touch target where practical, even if the visual icon is smaller.
- Announce loading, no-results, and relevant selection changes when they are not otherwise conveyed to screen readers.
- Maintain contrast for text and interactive states. Do not use color as the only state indicator.
- Test at 200% zoom and with keyboard-only navigation.

### 14. CSS Tokens and Example

Use tokens from the primary project design system when available. This standalone component layer may define aliases for consistency:

```css
:root {
  --picker-bg: #171717;
  --picker-text: #ffffff;
  --picker-text-secondary: #b4b4b4;
  --picker-text-muted: #777777;
  --picker-border: #383838;
  --picker-border-hover: #444444;
  --picker-option-hover: #202020;
  --picker-option-selected: #262626;
  --picker-option-pressed: #2a2a2a;
  --picker-radius: 10px;
  --picker-option-radius: 6px;
  --picker-panel-shadow: 0 8px 24px rgb(0 0 0 / 32%);
  --picker-option-height: 40px;
  --picker-transition: 140ms ease-out;
}

.picker-trigger {
  min-height: 40px;
  padding: 0 12px;
  color: var(--color-text-primary, #ffffff);
  background: var(--color-surface, #0a0a0a);
  border: 1px solid var(--color-border, #2a2a2a);
  border-radius: var(--picker-radius);
  transition:
    background-color var(--picker-transition),
    border-color var(--picker-transition);
}

.picker-trigger:disabled {
  color: var(--color-text-disabled, #666666);
  cursor: not-allowed;
}

@media (hover: hover) and (pointer: fine) {
  .picker-trigger:not(:disabled):hover {
    background: #111111;
    border-color: var(--picker-border-hover);
  }
}

.picker-trigger:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}

.picker-panel {
  color: var(--picker-text);
  background: var(--picker-bg);
  border: 0; /* project override: no panel border */
  border-radius: var(--picker-radius);
  box-shadow: var(--picker-panel-shadow);
  padding: 4px;
}

.picker-option {
  min-height: var(--picker-option-height);
  padding: 8px 10px;
  border-radius: var(--picker-option-radius);
  color: var(--picker-text);
  background: transparent;
  transition: background-color var(--picker-transition);
}

@media (hover: hover) and (pointer: fine) {
  .picker-option:not([aria-disabled="true"]):hover {
    background: var(--picker-option-hover);
  }
}

.picker-option[aria-selected="true"] {
  background: var(--picker-option-selected);
}

.picker-option:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: -2px;
}

@media (prefers-reduced-motion: reduce) {
  .picker-trigger,
  .picker-option {
    transition: none;
  }
}
```

> CSS is illustrative. The correct keyboard and ARIA behavior depends on the chosen component semantics and should be implemented with an accessible component primitive where possible. Do not treat these styles alone as a complete accessible picker.

### 15. Responsive and Touch Behavior

- Do not require hover to discover an action or read a label.
- Make the trigger easy to tap; aim for `44px` minimum height on touch-first layouts.
- For a long picker on a small screen, consider a bottom sheet or full-screen picker if it provides better usability. Preserve the same color tokens and option states.
- Ensure the panel remains inside the visual viewport when the mobile keyboard appears.
- Prevent background scrolling only when the picker is presented as a modal/bottom sheet and the interaction design requires it.
- Support safe-area insets in full-screen and bottom-sheet layouts.

### 16. Implementation Rules for AI Coding Agents

Before editing the app:

1. Inspect the existing component library, design tokens, Tailwind/CSS conventions, and dropdown/picker implementations. Reuse established patterns when possible.
2. Identify whether each component is an action menu, single-select, combobox, multi-select, command menu, or date/time picker. Do not force one behavior onto every pattern.
3. Keep the application's black background and white primary-button system intact. Use elevated dark panels, subtle neutral hover states, and explicit selected indicators.
4. Implement all states: default, hover, focus-visible, open, active, selected, selected-hover, pressed, disabled, loading, empty, and invalid where relevant.
5. Ensure keyboard support, appropriate semantics, focus restoration, outside-click behavior, and reduced-motion support.
6. Avoid introducing a new dependency if the repository already includes an accessible primitive that meets the requirement.
7. Do not refactor unrelated components or change unrelated business logic.
8. Test pointer, keyboard-only, touch-sized viewport, long labels, empty results, disabled options, and opening near viewport edges.
9. Run the project's existing lint, typecheck, and tests when available. Fix regressions caused by the change.
10. Report the files changed, interaction behavior implemented, and any accessibility or testing limitations honestly.

### 17. Acceptance Checklist

- [ ] Main application background remains `#000000`.
- [ ] Primary buttons remain white with black labels.
- [ ] Dropdown/picker panel uses a dark elevated surface and shadow, with no border.
- [ ] Hover is neutral, fast, and does not shift layout.
- [ ] Hover, active, selected, focus, and disabled states are visually distinct.
- [ ] Selected options show a persistent selection indicator.
- [ ] Disabled options cannot be activated.
- [ ] Panel flips/shifts to stay within the viewport.
- [ ] Escape closes the panel and restores focus appropriately.
- [ ] Keyboard navigation follows the chosen semantic pattern.
- [ ] Touch interactions do not depend on hover.
- [ ] Loading, empty, error, and long-label states are handled.
- [ ] Reduced-motion settings are respected.
- [ ] Existing project lint, typecheck, and tests pass, where available.
