# Setup

Every setup needs Tailwind CSS v4 and the HeroUI stylesheet, imported in this order:

```css
@import "tailwindcss";
@import "@heroui/styles";
```

Put theme overrides in the same file, after the imports (see "Rebrand" below).

## Next.js (App Router)

```bash
npm i @heroui/react @heroui/styles tailwind-variants tailwindcss @tailwindcss/postcss postcss @gravity-ui/icons
```

`postcss.config.mjs`:

```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`app/globals.css` holds the two imports. `app/layout.tsx` imports `./globals.css` and sets `<html lang="en" suppressHydrationWarning>`. HeroUI v3 has no provider.

Components that use state or event handlers need `"use client"` at the top of their file.

## Vite + React

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm i @heroui/react @heroui/styles tailwind-variants tailwindcss @tailwindcss/vite @gravity-ui/icons
```

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({ plugins: [react(), tailwindcss()] });
```

`src/index.css` holds the two imports. `src/main.tsx` imports it.

## Vite + Vue

```bash
npm create vite@latest my-app -- --template vue-ts
cd my-app
npm i @heroui/styles tailwind-variants tailwindcss @tailwindcss/vite
```

Add `tailwindcss()` to the plugins in `vite.config.ts`, after `vue()`. Put the two imports in `src/style.css`.

Vue uses the CSS layer only. Take classes from the variant functions (`buttonVariants`) or write them as BEM strings. See `css-classes.md`.

For icons, use the SVG files from `@gravity-ui/icons` so the set matches the React side. Inline them or load them with `vite-svg-loader`.

## Svelte, Solid, and Astro

Follow that framework's Tailwind v4 guide. Add `@import "@heroui/styles";` after `@import "tailwindcss";`, then use the CSS layer. Astro can also mount `@heroui/react` components as React islands.

## Plain HTML

Tailwind v4 compiles the HeroUI CSS (`@apply`, `@theme`), so you need a build step. A CDN `<script>` is not enough.

```bash
npm i -D tailwindcss @tailwindcss/cli @heroui/styles
```

`src/input.css` holds the two imports. Build it:

```bash
npx @tailwindcss/cli -i src/input.css -o dist/styles.css --watch
```

Link `dist/styles.css` from the page. Tailwind scans the HTML files in the project for the utilities you use.

## Dark mode

Set `class="dark" data-theme="dark"` on `<html>`. Follow the system setting with a small script before the first paint:

```html
<script>
  if (matchMedia("(prefers-color-scheme: dark)").matches) {
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.theme = "dark";
  }
</script>
```

## Rebrand

Override tokens after the imports. Change as few as you can. The accent alone is usually enough.

```css
:root {
  --accent: oklch(0.62 0.17 160);
  --accent-foreground: oklch(0.99 0 0);
  --radius: 0.5rem;
}

.dark,
[data-theme="dark"] {
  --accent: oklch(0.7 0.15 160);
}
```

Check every accent you pick for contrast against `--accent-foreground`. Aim for at least 4.5:1 on button text.
