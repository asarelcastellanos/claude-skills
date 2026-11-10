---
name: "ship-a-change"
description: "Use for any coding task you carry from request to merged PR. It walks nine steps: the user approves the plan and the final PR, Sonnet and Haiku agents do the work, and the main session supervises."
---

# Ship a change

This skill is the full process for one code change. The main session (Opus) runs it as the orchestrator: it plans, delegates, and supervises. Agents do the work, as the `model-roles` skill describes. The user approves twice, once for the plan and once for the PR into main.

It calls `model-roles`, `verify-before-pr`, `pr-review`, `address-review-findings`, and `git-messages`. If one of them is missing, follow the step as written here and tell the user which skill was missing.

Create a task list with the nine steps below at the start. Tick each one off as you finish it.

## 1. Understand the task

Restate the request in one or two sentences. Read the repo's CLAUDE.md, REVIEW.md, and LESSONS.md if they exist.

Send questions about the code to `model-policy:scout` or `Explore`: where something is handled, who calls a function, whether the tests pass today. Read the key files yourself only when you need them to decide the approach.

Ask the user a question only if a wrong guess would be expensive to undo. Otherwise pick the most reasonable reading, state it, and continue.

## 2. Plan, then get the plan approved

Write the plan in this shape:

- Goal: one or two sentences.
- Approach: for anything beyond a small fix, two or three options in a line each, and the one you picked with the reason.
- Pieces: each piece of work, the agent that does it (`model-policy:coder`, `model-policy:mechanic`, or `model-policy:scout`), and which pieces can run in parallel.
- Tests: what new tests prove the change works. For a bug, the test that reproduces it.
- Size: an estimate in lines. If it passes about 400 lines or mixes unrelated work, split it into separate PRs and plan the first one.
- Risk tier: low, medium, or high, using the tiers in `verify-before-pr`.

Show the plan and wait for the user's approval. Don't create a branch or spawn a coder before they approve. If the plan changes in a way the user would care about later, show the change and ask again.

## 3. Build through agents

Create a branch. Never work on the default branch.

Hand each piece to its agent with a spec, as `model-roles` describes. For a bug fix, the first piece is the failing test: have the coder write it and show it failing before the fix.

Read each agent's report and diff before you accept it. Send corrections to the same agent with SendMessage. Don't fix the code yourself.

Commit on the branch in small steps, with messages that follow `git-messages`. Branch commits don't need the user's approval.

## 4. Verify

Run the `verify-before-pr` skill. Do not skip it because the change looks small.

## 5. Review

Run the `pr-review` skill from the main session. It spawns fresh-context `model-policy:reviewer` agents directly. Don't hand the whole review to one agent, because a subagent can't start agents of its own. Pick the depth from the risk tier: low gets quick, medium gets standard, and high gets deep.

## 6. Address findings

Run the `address-review-findings` skill on the review report. Fixes go to a coder, never to a reviewer. After fixing, run `pr-review` again on the new diff only.

Repeat steps 5 and 6 for at most three rounds. If Important findings remain after round 3, go back to step 2. Tell the user the approach may be wrong and propose another one.

## 7. Open the PR and get it approved

Push the branch and open a PR into the default branch, with the title and description `verify-before-pr` wrote. Give the user the link, the risk tier, and a short summary. This is the user's review.

Before merge, confirm:

- CI is green.
- Every review thread has an answer.
- The user approved the PR. An agent's approval never counts as a person's.
- New commits after an approval get approved again.

Merge only after the user approves.

## 8. Record lessons

Look at what the reviews and checks found. For each mistake worth remembering, add an entry to LESSONS.md at the repo root, and create the file if it doesn't exist:

```
## YYYY-MM-DD: <short title>
- What happened: <the mistake, in one sentence>
- Caught by: <review round N, CI, the user, or production>
- Fix: <the lasting fix: a lint rule, a test, a CLAUDE.md or REVIEW.md line, or a skill edit, with a link>
```

If the same mistake is already in LESSONS.md, it has happened before. Propose a lasting fix to the user instead of a second entry. A lesson that applies to every project, not just this repo, becomes a proposed edit to the skills repo.

Commit LESSONS.md on the branch, so it goes into main with the PR.

## 9. Clean up

After the merge, delete the branch, locally and on the remote. If the change later causes a revert or a bug, add a LESSONS.md entry for it, with what the review should have caught.

## Final report

End with a short summary for the user. Include what changed, the check results, how many review rounds it took, the risk tier, the PR link, and the lessons recorded.
