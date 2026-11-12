---
name: "verify-before-pr"
description: "Use before opening a PR, pushing, or calling a coding task done. It runs the real checks and each issue's done-when tests, trims the diff, and has the PR description written."
---

# Verify before PR

Run this after you finish a code change. Run it before you open a PR, push, or tell the user the work is done. Do every step.

## 1. Run the real checks

Find the project's checks in CLAUDE.md, package.json scripts, the Makefile, pyproject.toml, or the CI config. Run the tests, type checks, linter, and build.

Paste each command and the end of its output. Never write "tests pass" without output that shows it. If a check fails, fix it and run it again. If a check cannot run here, name it and say why.

## 2. Prove each issue is solved

Run every check on each issue's "Done when" list. Report each issue with its checks and what they showed. An issue whose checks don't all pass is not done.

If the change has no issues, as with a small change that skipped `ship-a-change`, check it against what the user asked for instead.

## 3. Check behavior end to end

Use the changed behavior the way a user would. Run the CLI command, call the endpoint, load the page, or run the script on sample input. Write down what you ran and what happened.

For a bug fix, reproduce the bug before the fix and show it gone after. Confirm the fix addresses the root cause.

For a UI change, use the "Verify the page" section in the `web-ui` skill.

## 4. Simplify the diff

Read the full diff again. Remove dead code, debug prints, unused imports, commented-out code, and edits unrelated to the task. Remove abstractions the change does not need yet.

Keep the change sized as the "Size and grouping" rules in `ship-a-change` say. If it is too big or mixes unrelated changes, propose splitting it into separate PRs. If it is too small for its own PR, batch it into the next related PR or use the direct-commit path, as `ship-a-change` describes.

## 5. Get the PR description written

Do not write the PR description yourself. Send an outline to a `model-policy:coder`: the changes, the check results, the risk tier, and the issues the PR solves. Tell it to follow the PR description format in the `git-messages` skill, to write the description to a file in the session scratchpad (a temp dir if none is named), and to report the path under "Notes". Its Risk section names the tier and how to revert. The Changes section ends with a `Closes #N` line for each issue the PR solves. When the task has checkpoints, a feature PR targets the checkpoint branch and leaves the `Closes #N` lines for the final PR from the checkpoint branch, because a `Closes` line in a PR into a non-default branch does not close the issue.

Set the risk tier from what the change touches. Never set it from who wrote the change. The tiers are:

- Low. Docs, copy, internal-only tools, and additive changes behind a feature flag.
- Medium. Ordinary product changes, caching, config, and prompts.
- High. Auth, billing, data migrations, CI workflow files, installers, updaters, and anything that deletes data.

The user reviews every PR into the default branch. For a high-risk change, point them to the parts that need the closest look. An agent's approval never replaces a person's.

Review the file against `unslop` and the diff, then give the file to the next step. Inside `ship-a-change`, the PR opens at step 8, after the review. Used on its own, open the PR after `pr-review`.

## 6. Report

Tell the user what changed, the check results, each issue's result, and the risk tier. Keep it short.

This skill does not review the change. Inside `ship-a-change`, the review comes next, once, at step 5, and lessons go into LESSONS.md only at step 7. Used on its own for a change that needs a review, run `pr-review` once before the PR into the default branch.
