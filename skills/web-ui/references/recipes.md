# Recipes

Recipes are the building pieces. Each one is a fixed arrangement of kit components with fixed spacing. Build a page by stacking recipes inside the app shell, with `gap-8` between them.
Each recipe below shows React (`@heroui/react`) and HTML (`@heroui/styles`). For Vue, use the HTML version and bind classes with `:class`.

## 1. App shell

A top bar, then a centered content column on the page background.

```tsx
<div className="min-h-dvh bg-background text-foreground">
  <header className="border-b border-separator">
    <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
      <a href="/" className="text-sm font-semibold">Acme</a>
      <nav className="flex gap-4 text-sm">
        <a href="/projects" aria-current="page" className="text-foreground">Projects</a>
        <a href="/billing" className="text-muted hover:text-foreground">Billing</a>
      </nav>
      <div className="ml-auto"><Avatar size="sm"><Avatar.Fallback>JR</Avatar.Fallback></Avatar></div>
    </div>
  </header>
  <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">{children}</main>
</div>
```

For many sections, use a sidebar instead: `grid lg:grid-cols-[15rem_1fr]`. Give the sidebar `bg-surface-secondary`. Put the links in a `flex flex-col gap-1`. Each link is `rounded-xl px-3 py-2 text-sm`, and the active one adds `bg-default`.

## 2. Page header

A title, one line of context, and at most one primary action.

```tsx
<div className="flex flex-wrap items-end justify-between gap-4">
  <div className="flex flex-col gap-1">
    <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
    <p className="text-sm text-muted">12 projects, 3 deploying now.</p>
  </div>
  <Button variant="primary">New project</Button>
</div>
```

```html
<div class="flex flex-wrap items-end justify-between gap-4">
  <div class="flex flex-col gap-1">
    <h1 class="text-2xl font-semibold tracking-tight">Projects</h1>
    <p class="text-sm text-muted">12 projects, 3 deploying now.</p>
  </div>
  <button class="button button--primary">New project</button>
</div>
```

## 3. Stat row

Two to four numbers that the user checks every visit. Each number shows its label and its change. Don't add icons.

```tsx
<div className="grid gap-4 sm:grid-cols-3">
  {stats.map((s) => (
    <Card key={s.label}>
      <Card.Content className="flex flex-col gap-1">
        <span className="text-sm text-muted">{s.label}</span>
        <span className="text-3xl font-semibold tabular-nums">{s.value}</span>
        <span className="text-xs text-muted tabular-nums">{s.change} vs last week</span>
      </Card.Content>
    </Card>
  ))}
</div>
```

```html
<div class="grid gap-4 sm:grid-cols-3">
  <article class="card card--default">
    <div class="card__content flex flex-col gap-1">
      <span class="text-sm text-muted">Requests</span>
      <span class="text-3xl font-semibold tabular-nums">48,210</span>
      <span class="text-xs text-muted tabular-nums">+6.2% vs last week</span>
    </div>
  </article>
</div>
```

## 4. Table section

A section title, an optional filter, and a table. Add a status chip only where status matters.

```tsx
<section className="flex flex-col gap-4">
  <div className="flex items-center justify-between gap-4">
    <h2 className="text-base font-semibold">Recent deployments</h2>
    <SearchField aria-label="Filter deployments" className="w-56">
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input placeholder="Filter" />
        <SearchField.ClearButton />
      </SearchField.Group>
    </SearchField>
  </div>
  <Table>
    <Table.ScrollContainer>
      <Table.Content aria-label="Recent deployments">
        <Table.Header>
          <Table.Column isRowHeader>Project</Table.Column>
          <Table.Column>Status</Table.Column>
          <Table.Column>Duration</Table.Column>
        </Table.Header>
        <Table.Body>
          {rows.map((r) => (
            <Table.Row key={r.id}>
              <Table.Cell>{r.project}</Table.Cell>
              <Table.Cell><Chip size="sm" color={r.color}>{r.status}</Chip></Table.Cell>
              <Table.Cell className="tabular-nums">{r.duration}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Content>
    </Table.ScrollContainer>
  </Table>
</section>
```

```html
<section class="flex flex-col gap-4">
  <h2 class="text-base font-semibold">Recent deployments</h2>
  <div class="table-root table-root--primary">
    <div class="table__scroll-container">
      <table class="table__content">
        <thead class="table__header">
          <tr><th class="table__column">Project</th><th class="table__column">Status</th><th class="table__column">Duration</th></tr>
        </thead>
        <tbody class="table__body">
          <tr class="table__row">
            <td class="table__cell">api-gateway</td>
            <td class="table__cell"><span class="chip chip--secondary chip--success chip--sm"><span class="chip__label">Ready</span></span></td>
            <td class="table__cell tabular-nums">42s</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</section>
```

## 5. Form section

The label and help text sit on the left. The fields sit in a card on the right. Actions go at the bottom right. Stack the columns on narrow screens.

```tsx
<section className="grid gap-6 md:grid-cols-[16rem_1fr]">
  <div className="flex flex-col gap-1">
    <h2 className="text-base font-semibold">Profile</h2>
    <p className="text-sm text-muted">Shown to people you invite.</p>
  </div>
  <Card>
    <Form className="flex flex-col gap-4">
      <Card.Content className="flex flex-col gap-4">
        <TextField name="name" isRequired>
          <Label>Name</Label>
          <Input />
          <FieldError />
        </TextField>
        <TextField name="email" type="email" isRequired>
          <Label>Email</Label>
          <Input />
          <Description>We send receipts here.</Description>
          <FieldError />
        </TextField>
      </Card.Content>
      <Card.Footer className="justify-end gap-2">
        <Button variant="tertiary">Cancel</Button>
        <Button variant="primary" type="submit">Save</Button>
      </Card.Footer>
    </Form>
  </Card>
</section>
```

## 6. Empty state

Say what is missing, why it matters, and give the one action that fixes it. Use a plain icon or none. Don't use an illustration.

```tsx
<div className="flex flex-col items-center gap-3 rounded-3xl bg-surface-secondary px-6 py-12 text-center">
  <p className="text-sm font-medium">No deployments yet</p>
  <p className="max-w-sm text-sm text-muted">Push to main or run `acme deploy` to create the first one.</p>
  <Button variant="secondary" size="sm">Read the deploy guide</Button>
</div>
```

## 7. Loading state

Match the shape of the content that is loading. Don't use a full-page spinner when the layout is known.

```tsx
<div className="grid gap-4 sm:grid-cols-3">
  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-3xl" />)}
</div>
```

```html
<div class="skeleton skeleton--shimmer h-28 rounded-3xl"></div>
```

## 8. Marketing section

Use this when a landing page is actually needed. Lead with what the product does in one concrete sentence. Show the product itself, such as a screenshot or real UI, and don't use an abstract blob.

```tsx
<section className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center">
  <div className="flex flex-col gap-5">
    <h1 className="text-4xl font-semibold tracking-tight text-balance">Preview every pull request on its own URL</h1>
    <p className="text-lg text-muted text-pretty">Acme builds each branch in about 40 seconds and comments the link on the PR.</p>
    <div className="flex gap-2">
      <Button variant="primary" size="lg">Start a project</Button>
      <Button variant="tertiary" size="lg">Read the docs</Button>
    </div>
  </div>
  <img src="/screenshot.png" alt="A pull request with an Acme preview link" className="rounded-3xl shadow-surface" />
</section>
```

Feature lists are prose rows, not identical cards: `grid sm:grid-cols-2 gap-x-10 gap-y-6`. Each item has a `font-medium` title and a `text-muted` sentence with a fact or a number.
