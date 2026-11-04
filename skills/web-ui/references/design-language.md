# Design language

This file covers the HeroUI v3 default theme (`@heroui/styles` 3.2.x). The source is HeroUI's `DESIGN.md` at https://heroui.com/react/DESIGN.md. Use the semantic token in code. The raw values are here for checking and handoff only.

## Color tokens

Each `--color-*` variable is a Tailwind utility: `--color-surface` gives you `bg-surface`, `text-surface`, and `border-surface`.

| Role | Tokens | Light | Dark | Use for |
|---|---|---|---|---|
| Canvas | `background`, `foreground` | `oklch(0.9702 0 0)`, `oklch(0.2103 0.0059 285.89)` | `oklch(12% 0.005 285.823)`, `oklch(0.9911 0 0)` | Page background and main text |
| Surface | `surface`, `surface-foreground` | white | `oklch(0.2103 0.0059 285.89)` | Cards and containers that don't float |
| Surface 2 | `surface-secondary` | `oklch(0.9524 0.0013 286.37)` | `oklch(0.257 0.0037 286.14)` | Nested or lower-emphasis regions |
| Surface 3 | `surface-tertiary` | `oklch(0.9373 0.0013 286.37)` | `oklch(0.2721 0.0024 247.91)` | Stronger separation |
| Overlay | `overlay`, `overlay-foreground` | white | `oklch(0.2103 0.0059 285.89)` | Popovers, menus, dialogs, tooltips |
| Backdrop | `backdrop` | black at 50% | black at 60% | Dimming behind overlays |
| Muted | `muted` | `oklch(0.5517 0.0138 285.94)` | `oklch(70.5% 0.015 286.067)` | Supporting text, secondary icons |
| Neutral | `default`, `default-foreground` | `oklch(94% 0.001 286.375)` | `oklch(27.4% 0.006 286.033)` | Neutral controls, selected states |
| Accent | `accent`, `accent-foreground` | `oklch(0.6204 0.195 253.83)` | same | Primary action, focus, emphasis |
| Success | `success` | `oklch(0.7329 0.1935 150.81)` | same | Positive outcomes |
| Warning | `warning` | `oklch(0.7819 0.1585 72.33)` | `oklch(0.8203 0.1388 76.34)` | Caution |
| Danger | `danger` | `oklch(0.6532 0.2328 25.74)` | `oklch(0.594 0.1967 24.63)` | Errors, destructive actions |
| Field | `field`, `field-foreground`, `field-border` | white | dark | Inputs |
| Border | `border` | `oklch(90% 0.004 286.32)` | `oklch(28% 0.006 286.033)` | Component edges |
| Separator | `separator` | `oklch(92% 0.004 286.32)` | `oklch(25% 0.006 286.033)` | Quiet dividers |

The theme derives hover, soft, and focus versions with `color-mix()`. Use the utilities it provides, such as `bg-accent-hover`, `bg-accent-soft`, `text-accent-soft-foreground`, and `bg-danger-soft`. Don't write your own mixes.

The full list of color utilities follows. Each status color (accent, success, warning, danger, default) has the same set: base, `-foreground`, `-hover`, `-soft`, `-soft-foreground`, and `-soft-hover`. The other utilities are `background-secondary`, `background-tertiary`, `background-inverse`, `border-secondary`, `border-tertiary`, `separator-secondary`, `separator-tertiary`, `surface-hover`, `field-hover`, `field-focus`, `field-placeholder`, `field-border-hover`, `field-border-focus`, `focus`, `link`, `segment`, and `segment-foreground`.

## Dark mode

Set it on the root element: `<html class="dark" data-theme="dark">`. The tokens switch on their own. Don't write `dark:` variants for colors that come from tokens.

## Type

- HeroUI inherits the app font and Tailwind's type scale.
- Headings are short and in sentence case.
- `text-foreground` is for primary content and `text-muted` is for supporting content.
- Use `tabular-nums` for metrics, prices, counters, and columns of numbers.
- Avoid all-caps labels.

Use this scale in apps:

| Role | Classes |
|---|---|
| Page title | `text-2xl font-semibold tracking-tight` |
| Section title | `text-base font-semibold` |
| Card title | the `Card.Title` component or `card__title` |
| Body | `text-sm` |
| Supporting text | `text-sm text-muted` |
| Big metric | `text-3xl font-semibold tabular-nums` |

Marketing pages can go one or two steps larger. They still use one display size per page.

## Space

`--spacing: 0.25rem` gives a 4px grid. Use the scale steps, never arbitrary values such as `p-[13px]`. Group related items tightly (`gap-2`, `gap-3`) and separate groups widely (`gap-8`, `gap-10`).

## Radius

`--radius: 0.5rem`. Fields use `--field-radius`, which is 1.5 × radius, or 12px. Buttons are pill-shaped (`rounded-3xl`) by default. The utilities run from `rounded-xs` (2px) to `rounded-4xl` (32px). A nested element uses a smaller radius than its parent.

## Elevation

| Utility | Use for |
|---|---|
| `shadow-surface` | Cards and raised content |
| `shadow-overlay` | Dialogs, menus, popovers |
| `shadow-field` | Form controls, when the component applies it |

In dark mode, surface and field shadows drop out. Overlays get a faint inset edge. Don't add custom shadows to components that already have elevation.

## States

- Focus: every interactive element shows the accent focus ring with a 2px offset. Never remove the outline without replacing it.
- Disabled: opacity 0.5 and the `not-allowed` cursor.
- In React, React Aria sets `data-hovered`, `data-pressed`, `data-focus-visible`, `data-selected`, `data-disabled`, and `data-invalid`. Outside React, simple components respond to native `:hover`, `:active`, `:focus-visible`, and `:disabled`. Stateful ones such as tabs, switches, and checkboxes need you to set `data-selected="true"` or `aria-checked="true"` yourself.

## Motion

Motion explains a change of state. It is not decoration. Respect `prefers-reduced-motion`. The components already do.
