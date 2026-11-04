# CSS classes for Vue, Svelte, Astro, and plain HTML

Use these classes when you can't use `@heroui/react`. They come from `@heroui/styles` 3.2.x, under `packages/styles/components/*.css` in https://github.com/heroui-inc/heroui (branch `v3`). If a class here looks wrong, check that source before guessing.

The naming follows BEM. A block is `.card`. An element is `.card__title`. A modifier is `.card--secondary`. Always pair a modifier with its block: `class="chip chip--success"`.

## Get classes from JavaScript

`@heroui/styles` exports a variant function for every component. These functions return class strings, so they work in any framework.

```ts
import { buttonVariants, cardVariants, chipVariants } from "@heroui/styles";

buttonVariants({ variant: "secondary", size: "sm" }); // "button button--sm button--secondary"

const card = cardVariants({ variant: "secondary" });
card.base(); card.header(); card.title(); card.description(); card.content(); card.footer();
```

In Vue, `:class="buttonVariants({ variant: 'primary' })"` keeps class names typed and in one place. Writing the strings by hand also works.

## Components that work on native elements

These components respond to native `:hover`, `:active`, `:focus-visible`, and `:disabled`. You don't need JavaScript for them.

| Component | Classes |
|---|---|
| Button | `button` + `button--primary` / `--secondary` / `--tertiary` / `--outline` / `--ghost` / `--danger` / `--danger-soft`, `button--sm` / `--md` / `--lg`, `button--icon-only`, `button--full-width` |
| Link | `link`, `link__icon` |
| Card | `card` + `card--default` / `--secondary` / `--tertiary` / `--transparent`; `card__header`, `card__title`, `card__description`, `card__content`, `card__footer` |
| Surface | `surface` + `surface--default` / `--secondary` / `--tertiary` / `--transparent` |
| Alert | `alert` + `alert--default` / `--accent` / `--success` / `--warning` / `--danger`; `alert__indicator`, `alert__content`, `alert__title`, `alert__description` |
| Chip | `chip` + style `chip--primary` / `--secondary` (the React default) / `--tertiary` / `--soft`, color `chip--accent` / `--success` / `--warning` / `--danger` / `--default`, size `chip--sm` / `--md` / `--lg`; `chip__label` |
| Badge | `badge-anchor` on the wrapper; `badge` + color, `badge--soft`, size, and position `badge--top-right` and similar; `badge__label` |
| Avatar | `avatar` + `avatar--sm` / `--md` / `--lg`, `avatar--soft`; `avatar__image`, `avatar__fallback` + `avatar__fallback--accent` and the other colors |
| Text field | `textfield` (wrapper), `label` (+ `label--required`), `input` (+ `input--secondary` on a surface), `description`, `field-error` |
| Text area | `textarea` + `textarea--secondary` |
| Separator | `separator` + `separator--horizontal` / `--vertical` |
| Kbd | `kbd`, `kbd__content` |
| Spinner | `spinner` + `spinner--sm` / `--md` / `--lg` / `--xl`, `spinner--current` / `--accent` |
| Skeleton | `skeleton` + `skeleton--shimmer` / `--pulse` |
| Typography | `typography` + `typography--h1` through `--h6`, `--body`, `--body-sm`, `--body-xs`, `--code`, `typography--color-muted`, `typography--weight-semibold`; `typography-prose` for long-form content |
| Empty state | `empty-state` |
| Table | `table-root` + `table-root--primary` / `--secondary`; `table__scroll-container`, `table__content` (on `<table>`), `table__header` (`<thead>`), `table__column` (`<th>`), `table__body` (`<tbody>`), `table__row` (`<tr>`), `table__cell` (`<td>`), `table__footer` |

## Components that need state attributes

These read state from attributes that React Aria sets in React. Outside React, you set them yourself, or you use the native control.

| Component | Classes | State to set |
|---|---|---|
| Tabs | `tabs`, `tabs__list-container`, `tabs__list`, `tabs__tab`, `tabs__indicator`, `tabs__panel` | `data-selected="true"` on the active tab, `data-orientation="horizontal"` on the list, plus `role="tablist"`, `role="tab"`, and `aria-selected` |
| Switch | `switch` (+ size), `switch__control`, `switch__thumb`, `switch__content` | `data-selected="true"` or `aria-checked="true"` on `.switch` |
| Checkbox | `checkbox`, `checkbox__control`, `checkbox__indicator`, `checkbox__content` | `data-selected="true"` or `aria-checked="true"` |

Modals, popovers, dropdowns, selects, and comboboxes depend on React Aria for focus management. Outside React, build them on `<dialog>`, the `popover` attribute, or a native `<select>`. Style them with `bg-overlay shadow-overlay rounded-3xl p-6`. In Vue, Reka UI is a headless option you can style with the same tokens.

## Markup

```html
<!-- Buttons: one primary per view -->
<div class="flex gap-2">
  <button class="button button--primary">Save changes</button>
  <button class="button button--tertiary">Cancel</button>
</div>

<!-- Link styled as a button -->
<a class="button button--secondary" href="/settings">Settings</a>

<!-- Card -->
<article class="card card--default">
  <header class="card__header">
    <h3 class="card__title">Monthly usage</h3>
    <p class="card__description">Resets on the 1st.</p>
  </header>
  <div class="card__content">…</div>
  <footer class="card__footer">…</footer>
</article>

<!-- Text field -->
<div class="textfield">
  <label class="label label--required" for="email">Email</label>
  <input class="input" id="email" type="email" placeholder="you@company.com" />
  <p class="description">We send receipts here.</p>
</div>

<!-- Invalid text field -->
<div class="textfield" data-invalid="true">
  <label class="label label--invalid" for="name">Name</label>
  <input class="input" id="name" aria-invalid="true" aria-describedby="name-error" />
  <p class="field-error" id="name-error">Enter a name.</p>
</div>

<!-- Alert -->
<div class="alert alert--danger" role="alert">
  <div class="alert__content">
    <p class="alert__title">Payment failed</p>
    <p class="alert__description">The card ending in 4242 was declined.</p>
  </div>
</div>

<!-- Status chip -->
<span class="chip chip--secondary chip--success chip--sm"><span class="chip__label">Active</span></span>

<!-- Avatar with fallback -->
<span class="avatar avatar--sm"><span class="avatar__fallback avatar__fallback--accent">JR</span></span>

<!-- Spinner -->
<svg class="spinner spinner--sm spinner--current" viewBox="0 0 24 24" fill="none" aria-label="Loading">
  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity=".25" stroke-width="3" />
  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
</svg>

<!-- Native dialog styled with tokens -->
<dialog class="m-auto w-full max-w-md rounded-3xl bg-overlay p-6 text-overlay-foreground shadow-overlay backdrop:bg-backdrop">
  <h2 class="text-base font-semibold">Delete project?</h2>
  <p class="mt-2 text-sm text-muted">This removes 14 deployments. You can't undo it.</p>
  <form method="dialog" class="mt-6 flex justify-end gap-2">
    <button class="button button--tertiary" value="cancel">Cancel</button>
    <button class="button button--danger" value="confirm">Delete project</button>
  </form>
</dialog>
```
