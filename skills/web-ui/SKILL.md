---
name: web-ui
description: "Build web UI from HeroUI v3 pieces with one design language, in any framework: React, Next.js, Vite, Vue, Astro, or plain HTML. Use when creating or restyling any page, component, layout, form, dashboard, landing page, or app shell, so the result looks designed rather than generic AI output."
---

# Web UI

Build every interface from one kit: HeroUI v3 on Tailwind CSS v4. Treat its components as fixed pieces. Compose them into pages. Don't invent new visual styles.

The kit has two layers, and the framework decides which one you use:

| Framework | Use | How |
|---|---|---|
| React, Next.js, Vite + React, Remix, Astro islands | `@heroui/react` | Compound components: `<Card><Card.Header>`. Load the `heroui-react` skill for props and docs. |
| Vue, Svelte, Solid, Astro, plain HTML | `@heroui/styles` | The same CSS on native elements, through BEM classes: `<button class="button button--primary">`. See `references/css-classes.md`. |

Both layers read the same theme variables, so a Vue page and a React page from this skill look like one product.

## Principles

These principles come from HeroUI's design principles (`references/design-principles.md`).

1. **Name the intent, not the look.** Variants are `primary`, `secondary`, `tertiary`, and `danger`, never "blue" or "outlined". Primary means the one action that moves the user forward.
2. **Accessibility comes built in.** In React, the components use React Aria, so ARIA attributes, keyboard support, and focus come for free. Outside React, use native elements (`<button>`, `<a>`, `<dialog>`, `<input>`) so the browser provides them.
3. **Compose, don't configure.** Build from parts (`Card.Header`, `Card.Content`), and leave out the parts you don't need. Don't add props to imitate a layout.
4. **Start minimal.** Use the bare component first. Add size, icons, or loading states only when the screen needs them.
5. **Expect the same API everywhere.** Sizes are `sm`, `md`, and `lg` across the kit. Every component takes `className`.
6. **Styles are separate from logic.** The look comes from `@heroui/styles`. That's why the same classes work in Vue, plain HTML, and React.
7. **Extend, don't fork.** To style a framework element, use the kit's classes or variant functions: `<NextLink className={buttonVariants({ variant: "primary" })}>`. To add a variant, use `tv({ extend: buttonVariants, ... })`. Don't copy and edit component CSS.
8. **Customize with variables first.** Change `--accent`, `--radius`, or `--spacing` in `:root` before you touch a single component.

## Workflow

1. Pick the layer from the table at the top.
2. Set up the project with `references/setup.md`. Tailwind v4 is required. HeroUI v3 does not work on Tailwind v3.
3. Sketch the page as a stack of recipes from `references/recipes.md`: app shell, page header, stat row, table section, form section, and empty state. Most screens need four or fewer.
4. Fill each recipe with kit components. Reach for a custom element only when no component fits, and build it from tokens (see below).
5. Check the result against the rules in "Don't ship slop" before you call it done.

The same deployments dashboard is built three ways. Start from the one closest to your stack:

- `examples/react/dashboard.tsx`
- `examples/vue/Dashboard.vue`
- `examples/html/dashboard.html`
## Use tokens, not colors

The theme is a set of semantic tokens. Each one is a Tailwind utility. Never use raw palette classes such as `bg-indigo-600`, `text-gray-500`, or `border-slate-200` in product code. Raw colors break dark mode and break the shared look.

| Need | Utility |
|---|---|
| Page background | `bg-background text-foreground` |
| Card or raised region | `bg-surface shadow-surface` |
| Nested or quieter region | `bg-surface-secondary`, then `bg-surface-tertiary` |
| Menus, popovers, dialogs | `bg-overlay shadow-overlay` |
| Secondary text, icons | `text-muted` |
| Brand emphasis, primary action | `bg-accent text-accent-foreground`, soft: `bg-accent-soft text-accent-soft-foreground` |
| Status | `success`, `warning`, `danger`, each with `-soft` and `-foreground` |
| Lines | `border-border`, and `border-separator` for quiet dividers |

Full values and rules: `references/design-language.md`.

To rebrand, change `--accent` (and only the tokens you need) in one CSS block. Don't restyle components one at a time.

## Compose with these rules

- **One primary button per view.** Other actions use `secondary`, `tertiary`, `outline`, or `ghost`. Destructive actions use `danger` or `danger-soft`.
- **Build hierarchy with order, spacing, type, and surface level.** Add a border or a shadow only when those four fail.
- **Use one spacing scale.** Gaps come from the 4px scale: `gap-2`, `gap-4`, `gap-6`, `gap-8`. Sections use `gap-8` or `gap-10`. Don't double the padding of a parent and its child on the same side.
- **Use one radius family.** Components bring their own radius. A custom container uses `rounded-2xl` or `rounded-3xl`, and anything nested inside it uses a smaller radius.
- **Constrain width.** App content sits in `mx-auto max-w-6xl px-4 sm:px-6`. Prose stops at `max-w-prose`.
- **Use the type scale as given.** Page title `text-2xl font-semibold`, section title `text-base font-semibold`, body `text-sm`, supporting text `text-sm text-muted`. Use `tabular-nums` for numbers that change or line up.
- **Use one icon set.** HeroUI uses `@gravity-ui/icons`. Don't mix it with Heroicons, Lucide, or emoji in the same product.
- **Show every state.** Each data view has loading (`Skeleton`), empty (the empty-state recipe), and error (`Alert` with `danger`) states, plus the normal one.
- **Pair color with text.** A status chip says "Failed". It is not only red.

## Don't ship slop

These patterns mark a page as generic AI output. Remove them.

- Gradient text, purple-to-pink gradients, glows, and glassmorphism blur panels.
- A hero with a centered headline, a gradient blob, and two buttons, used by default whatever the product is.
- Three identical feature cards with an emoji or icon, a two-word title, and one vague sentence each.
- Cards inside cards inside cards. Use a surface level or a separator.
- Every element wrapped in a border and a shadow.
- Badges, chips, or icons beside every heading.
- The accent color used for decoration instead of meaning.
- Hover lift or scale effects on things that aren't clickable.
- Placeholder copy such as "Lorem ipsum", "Feature one", "Your amazing product", or "Unlock the power of". Write the real label, number, or sentence. Apply the `unslop` skill to all UI copy.
- Title Case Headings. Use sentence case.
- Fake precision such as "99.9% faster" or invented testimonials.

## When the kit lacks a piece

1. Search the component list first: `references/css-classes.md`, or `node scripts/list_components.mjs` in the `heroui-react` skill.
2. Compose it from existing components and layout utilities.
3. If you still need a new element, build it only from tokens: `bg-surface`, `text-muted`, `border-separator`, `rounded-2xl`, and the spacing scale. Then it matches the kit.
4. For overlays outside React, use the native `<dialog>` element or the `popover` attribute and style them with `bg-overlay shadow-overlay rounded-3xl`. In Vue, a headless library such as Reka UI also works. Never hand-roll focus trapping.
