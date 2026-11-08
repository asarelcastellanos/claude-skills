# claude-skills

These are the skills and global instructions I run in [Claude Code](https://claude.com/claude-code). With them, Claude writes plain English, keeps git history readable, writes strict TypeScript, and builds web UI that looks designed rather than generated.

A skill is a folder with a `SKILL.md` file. Claude loads a skill when a task matches its description, or when you type `/skill-name`. This repo keeps mine in one place, so every machine I use gets the same behavior, and anyone can borrow the ones they like.

## What's inside

### Writing

| Skill | What it does |
|---|---|
| `unslop` | Removes AI writing patterns: filler, hedging, "leverage" and "delve", em dashes, sycophancy, and vague claims. `CLAUDE.md` imports it, so it applies to every reply. |
| `technical-writing` | Rules for docs, READMEs, and PRs, drawing on Diátaxis, the Google developer style guide, Simplified Technical English, and Global English. |
| `git-messages` | Commit messages and PR descriptions as short bullets that say what changed and why. They never include AI attribution lines. |

### Pull requests

| Skill | What it does |
|---|---|
| `ship-a-change` | Carries one code change from request to merged PR in eight steps, and calls the three skills below at the right points. |
| `verify-before-pr` | Runs the real checks, uses the change the way a user would, gets a fresh-context review, and sets the risk tier for the PR description. |
| `pr-review` | Reviews a diff for real bugs. Finder agents each take one lens, separate agents verify each finding, and re-reviews stop after three rounds. |
| `address-review-findings` | Gives every review finding an outcome, fixes each mistake everywhere it appears, and escalates to the user after three rounds. |

### Code

| Skill | What it does |
|---|---|
| `typescript-best-practices` | Discriminated unions, branded types, no `as` casts, exhaustive switches, and schema-first validation. `references/patterns.md` has examples. |
| `principle-type-system-discipline` | Make illegal states unrepresentable, and let the compiler catch the rest. |
| `principle-boundary-discipline` | Validate data where it enters the system, and trust the types inside. |
| `principle-encode-lessons-in-structure` | When a correction repeats, turn it into a lint, check, or script instead of another instruction. |

### Web UI

| Skill | What it does |
|---|---|
| `web-ui` | One design language for every web project, built on [HeroUI v3](https://heroui.com) and Tailwind CSS v4. It covers React, Next.js, Vue, Svelte, Astro, and plain HTML. It includes design tokens, page recipes, a list of AI-slop patterns to avoid, and the same dashboard built in React, Vue, and HTML. |
| `heroui-react` | HeroUI's official skill for component APIs and docs. It's included unchanged. |

Here is the `web-ui` example dashboard. The React, Vue, and HTML versions all render this way. Dark mode comes from the theme tokens, with no changes to component code.

![Example dashboard in light mode](docs/dashboard-light.png)

![Example dashboard in dark mode](docs/dashboard-dark.png)

## Install

Clone the repo anywhere, then run the install script:

```bash
git clone https://github.com/asarelcastellanos/claude-skills.git ~/claude-skills
```

| OS | Command |
|---|---|
| Windows (PowerShell) | `~/claude-skills/install.ps1` |
| macOS or Linux | `bash ~/claude-skills/install.sh` |

The script links each folder in `skills/` into `~/.claude/skills/`. On Windows it uses directory junctions, which need no admin rights. It also adds one import line to `~/.claude/CLAUDE.md` that points at this repo's `CLAUDE.md`. If you already have a skill with the same name, the script moves it to `~/.claude/skills-backup-<timestamp>/` first. Running the script again is safe.

The skills are links, not copies, so `git pull` updates them. You don't need to reinstall.

### Install only some skills

Copy the folders you want into `~/.claude/skills/` (every project) or `.claude/skills/` (one project). The skills are plain Markdown. Only `heroui-react` has scripts, and those need Node.js 18 or later.

Most skills stand alone. These depend on others:

- `technical-writing` and `git-messages` apply `unslop`, and `technical-writing` hands commit messages and PR descriptions to `git-messages`.
- `typescript-best-practices` and `principle-boundary-discipline` refer to `principle-type-system-discipline`, and it refers to `principle-encode-lessons-in-structure`.
- `web-ui` applies `typescript-best-practices` and `principle-boundary-discipline` to the code it writes.
- `web-ui` works best with `heroui-react` for React projects.
- `ship-a-change` runs `verify-before-pr`, `pr-review` and `address-review-findings`. `verify-before-pr` writes the PR description with `git-messages`.

## Make it yours

- **Writing rules:** edit `CLAUDE.md` to change what applies to every conversation.
- **Brand color:** change `--accent` in your project's CSS. Every `web-ui` component follows it. See `skills/web-ui/references/setup.md`.
- **New skills:** add a folder with a `SKILL.md` under `skills/`, then run the install script again.

## License

[MIT](LICENSE), except `skills/heroui-react/`. That folder is copied unchanged from [heroui-inc/heroui](https://github.com/heroui-inc/heroui/tree/v3/skills/heroui-react) under the Apache License 2.0, and its license is in `skills/heroui-react/LICENSE.txt`. The token values and principles in `skills/web-ui/references/` summarize HeroUI's public documentation.
