# HeroUI v3 design principles

This file condenses https://heroui.com/docs/react/getting-started/design-principles and keeps the code that applies to this skill. It leaves out the upstream examples that use gradients, because `SKILL.md` bans them.

## 1. Semantic intent over visual style

| Variant | Purpose | Usage |
|---|---|---|
| `primary` | Main action to move forward | One per context |
| `secondary` | Alternative actions | Several allowed |
| `tertiary` | Dismissive actions, such as cancel or skip | Sparingly |
| `danger` | Destructive actions | When needed |

```tsx
<Button variant="primary">Save</Button>
<Button variant="secondary">Edit</Button>
<Button variant="tertiary">Cancel</Button>
```

## 2. Accessibility as foundation

React components are built on React Aria Components and target WCAG 2.1 AA. They handle ARIA attributes, keyboard navigation, and screen reader support. Outside React, use the native element that has the behavior you need.

## 3. Composition over configuration

Compound components let you rearrange or omit parts. Dot notation (`Accordion.Item`) and named exports (`AccordionItem`) both work. Pick one style per codebase.

```tsx
<Accordion>
  <Accordion.Item id="1">
    <Accordion.Heading>
      <Accordion.Trigger>
        Question text
        <Accordion.Indicator />
      </Accordion.Trigger>
    </Accordion.Heading>
    <Accordion.Panel>
      <Accordion.Body>Answer content</Accordion.Body>
    </Accordion.Panel>
  </Accordion.Item>
</Accordion>
```

## 4. Progressive disclosure

```tsx
<Button>Save</Button>

<Button variant="primary" size="lg">Save changes</Button>

<Button variant="primary" isPending={isSaving}>
  {({ isPending }) => (isPending ? <><Spinner size="sm" color="current" />Saving</> : "Save")}
</Button>
```

## 5. Predictable behavior

Every component uses the sizes `sm`, `md`, and `lg`, accepts `className`, and exposes state through `data-*` attributes.

## 6. Type safety

Props are typed. Extend them instead of loosening them:

```tsx
import type { ButtonProps } from "@heroui/react";

interface SaveButtonProps extends Omit<ButtonProps, "variant"> {
  intent: "save" | "cancel" | "delete";
}
```

## 7. Separation of styles and logic

`@heroui/styles` holds the look. `@heroui/react` holds the behavior.

```html
<button class="button button--primary">Save</button>
```

```tsx
import { buttonVariants } from "@heroui/styles";

<a className={buttonVariants({ variant: "primary" })} href="/home">Home</a>
```

## 8. Customization through variables and BEM

```css
:root {
  --accent: oklch(0.62 0.19 160);
  --radius: 0.375rem;
}

@layer components {
  .button {
    @apply tracking-tight;
  }
}
```

## 9. Open and extensible

Here are four ways to extend the kit, in order of preference:

1. Use variant functions on framework components:

   ```tsx
   import { Link } from "@heroui/react";
   import { linkVariants } from "@heroui/styles";
   import NextLink from "next/link";

   const slots = linkVariants();

   <NextLink className={slots.base()} href="/about">
     About
     <Link.Icon className={slots.icon()} />
   </NextLink>
   ```

2. Use BEM classes on any element: `<NextLink className="button button--primary" href="/dashboard">`.
3. Write a wrapper component that maps your app's intents to kit variants.
4. Extend the kit with Tailwind Variants: `tv({ extend: buttonVariants, variants: { ... } })`. Use tokens in new variants, never raw palette colors.
