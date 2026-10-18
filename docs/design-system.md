# ChatGPT-Inspired Design System — Dark Canvas, White Buttons

> A practical UI design specification for AI coding agents. Use a restrained, minimal interface inspired by ChatGPT's clean conversational experience. This is a custom project specification, not an official OpenAI design-system document.

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

## 14. AI Coding Agent Implementation Rules

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

## 15. Definition of Done

- [ ] Main application background is black (`#000000`).
- [ ] Primary buttons are white with black labels.
- [ ] Secondary and ghost buttons use the defined dark treatments.
- [ ] Typography and spacing follow the design tokens.
- [ ] Hover, focus-visible, active, disabled, and loading states are implemented where applicable.
- [ ] Dialogs and forms work on mobile and desktop.
- [ ] Keyboard accessibility and visible focus styles are preserved.
- [ ] Existing product behavior has not been unintentionally removed.
- [ ] Available project checks have been run and their actual results reported.
