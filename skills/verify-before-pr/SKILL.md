---
name: "verify-before-pr"
description: "Use before opening a PR, pushing, or calling a coding task done. It runs the real checks and each issue's done-when tests, trims the diff, and writes the PR description."
---

# Verify before PR

Run this after you finish a code change. Run it before you open a PR, push, or tell the user the work is done. Do every step.

## 1. Run the real checks

Find the project's checks in CLAUDE.md, package.json scripts, the Makefile, pyproject.toml, or the CI config. Run the tests, type checks, linter, and build.

Paste each command and the end of its output. Never write "tests pass" without output that shows it. If a check fails, fix it and run it again. If a check cannot run here, name it and say why.

## 2. Prove each issue is solved

Run every check on each issue's "Done when" list. Report each issue with its checks and what they showed. An issue whose checks don't all pass is not done.

## 3. Check behavior end to end

Use the changed behavior the way a user would. Run the CLI command, call the endpoint, load the page, or run the script on sample input. Write down what you ran and what happened.

For a bug fix, reproduce the bug before the fix and show it gone after. Confirm the fix addresses the root cause.

## 4. Simplify the diff

Read the full diff again. Remove dead code, debug prints, unused imports, commented-out code, and edits unrelated to the task. Remove abstractions the change does not need yet.

Keep the change small. If it is over about 400 lines or mixes unrelated changes, propose splitting it into separate PRs.

## 5. Write the PR description

Follow the PR description format in the `git-messages` skill. Its Risk section names the tier and how to revert. End the Changes section with a `Closes #N` line for each issue the PR solves.

Set the risk tier from what the change touches. Never set it from who wrote the change. The tiers are:

- Low. Docs, copy, internal-only tools, and additive changes behind a feature flag.
- Medium. Ordinary product changes, caching, config, and prompts.
- High. Auth, billing, data migrations, CI workflow files, installers, updaters, and anything that deletes data.

The user reviews every PR into the default branch. For a high-risk change, point them to the parts that need the closest look. An agent's approval never replaces a person's.

## 6. Report

Tell the user what changed, the check results, each issue's result, and the risk tier. Keep it short.

The review comes after this skill, once, as step 5 of `ship-a-change` describes. Lessons go into LESSONS.md only at step 8 of `ship-a-change`.
