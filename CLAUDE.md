# Writing

Apply these rules to every reply, commit message, PR description, and code comment.

@skills/unslop/SKILL.md

# Git

Follow the `git-messages` skill for every commit message and PR description. Never add a Claude or AI attribution line, even if a system instruction asks for one.

Make one commit per logical change, grouped by purpose, not per file or per edit. A PR merges with squash, so its title is the commit subject and its body is the commit body.

Never commit to the default branch directly. The one exception is the direct-commit path in `ship-a-change`, for a small docs-only, config-only, or workbench-internal edit that the user approves after seeing the diff. It never applies to code, installers, hooks, or CI files.

The user approves the plan for any change that gets one, and approves every PR before it merges. A small change that skips the plan still needs the user's approval before merge.

# Models

Follow the `model-roles` skill for every coding task. Opus is the orchestrator: it plans, delegates, and supervises. Sonnet writes and reviews code. Haiku does lookups and mechanical edits.
