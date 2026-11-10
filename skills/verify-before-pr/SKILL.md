---
name: "verify-before-pr"
description: "Use before opening a PR, pushing, or calling a coding task done. It runs the real checks, gets a fresh-context review, and writes the PR description."
---

# Verify before PR

Run this after you finish a code change. Run it before you open a PR, push, or tell the user the work is done. Do every step.

## 1. Run the real checks

Find the project's checks in CLAUDE.md, package.json scripts, the Makefile, pyproject.toml, or the CI config. Run the tests, type checks, linter, and build.

Paste each command and the end of its output. Never write "tests pass" without output that shows it. If a check fails, fix it and run it again. If a check cannot run here, name it and say why.

## 2. Check behavior end to end

Use the changed behavior the way a user would. Run the CLI command, call the endpoint, load the page, or run the script on sample input. Write down what you ran and what happened.

For a bug fix, reproduce the bug before the fix and show it gone after. Confirm the fix addresses the root cause.

## 3. Get a fresh-context review

Spawn a `model-policy:reviewer` agent that has not seen your work. It runs on Opus. If that type isn't available, start the description with `review`. Give it the diff against the base branch and the stated intent of the change. Tell it to follow the `pr-review` skill. Do not give it your reasoning or your opinion of the code. Then follow the `address-review-findings` skill for what it reports.

## 4. Simplify the diff

Read the full diff again. Remove dead code, debug prints, unused imports, commented-out code, and edits unrelated to the task. Remove abstractions the change does not need yet.

Keep the change small. If it is over about 400 lines or mixes unrelated changes, propose splitting it into separate PRs.

## 5. Fix recurring problems at the source

If a review found a mistake that has happened before, propose a lasting fix to the user. The fix can be a lint rule, a line in CLAUDE.md or REVIEW.md, or an edit to a skill. Fixing one instance at a time does not stop the next one.

## 6. Write the PR description

Follow the PR description format in the `git-messages` skill. Its Risk section names the tier and how to revert.

Set the risk tier from what the change touches. Never set it from who wrote the change. The tiers are:

- Low. Docs, copy, internal-only tools, and additive changes behind a feature flag.
- Medium. Ordinary product changes, caching, config, and prompts.
- High. Auth, billing, data migrations, CI workflow files, installers, updaters, and anything that deletes data.

For a high-risk change, tell the user a person needs to review it before merge. An agent's approval never replaces a person's.

## 7. Report

Tell the user what changed, the check results, the review outcome, and the risk tier. Keep it short.