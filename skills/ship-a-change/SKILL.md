---
name: "ship-a-change"
description: "Use for a coding task worth a plan and a review, carried from request to merged PR. It walks nine steps: GitHub issues track the work, the user approves the plan and the final PR, Sonnet and Haiku agents do the work, and the main session supervises."
---

# Ship a change

This skill is the full process for one code change. The main session (Opus) runs it as the orchestrator: it plans, delegates, and supervises. Agents do the work, as the `model-roles` skill describes. The user approves twice, once for the plan and once for the PR into main.

It calls `model-roles`, `verify-before-pr`, `pr-review`, `address-review-findings`, and `git-messages`. If one of them is missing, follow the step as written here and tell the user which skill was missing.

## When to use it

Using the full process is a judgment call. Use it when a wrong change would cost time to undo, when the change touches several files or behaviors, or when the user asks for it.

A small, clear change skips it. Examples are a one-line fix, a setting, a copy edit, or a change the user spelled out exactly. Make the change through the right agent, run the checks, and commit it on a branch. Tell the user in one line that you skipped the process, so they can ask for it.

When you use it, create a task list with the nine steps below and tick each one off as you finish it.

## 1. Understand the task

Restate the request in one or two sentences. Read the repo's CLAUDE.md, REVIEW.md, and LESSONS.md if they exist.

Send questions about the code to `model-policy:scout` or `Explore`: where something is handled, who calls a function, whether the tests pass today. Read the key files yourself only when you need them to decide the approach.

The vaguer the request, the more questions you ask:

- A clear request, with a known goal, scope, and result: ask at most one question. State your reading and continue.
- A vague request: ask until you can name the goal, what is in and out of scope, and the checks that will prove it's done. Ask in rounds of a few questions with AskUserQuestion, and offer options where you can.
- Never plan around a guess about what the user wants. Write each answer into the issue it affects.

### When the user reports a failure

Whenever the user says something fails, breaks, or looks wrong, do this before you investigate or fix anything, even when the fix looks small:

1. Create a GitHub issue that states the report in the user's words.
2. Try to reproduce it. Have a `model-policy:scout` run the steps, or run them yourself.
3. Record the attempt on the issue with `gh issue comment`: the steps, what was expected, what happened, and whether it reproduced. Attach the output or a screenshot.
4. Then continue with understanding and planning. The reproduction becomes the first check on the issue's "Done when" list.

If it doesn't reproduce, say so on the issue and ask the user what differs on their side.

### Large or vague tasks

If the task is large, or too vague to plan in one pass, split it into checkpoints before you plan. Each checkpoint is a version, and the finished task is 1.0.0:

- A minor version (0.1.0, 0.2.0, and so on) is a checkpoint the user can see and test. Each one is a GitHub milestone.
- A patch version (0.1.1, 0.1.2) is one merged PR inside that checkpoint.
- Use as many checkpoints as the task needs. Earlier checkpoints answer the open questions that make the task vague.

Create a GitHub project board for the task, so the user can see every checkpoint and issue in one place. Show the checkpoints to the user with the plan for the first one.

## 2. Plan, track, then get the plan approved

Write one GitHub issue for each piece of work, with `gh issue create`. Each issue ends with a "Done when" list: the tests or checks that prove the issue is solved. Put each issue in its checkpoint's milestone and on the project board, if the task has them.

Write the plan in this shape:

- Goal: one or two sentences.
- Approach: for anything beyond a small fix, two or three options in a line each, and the one you picked with the reason.
- Issues: each issue's number and title, the agent that does it (`model-policy:coder`, `model-policy:mechanic`, or `model-policy:scout`), and which can run in parallel.
- Tests: for each issue, the tests or checks that prove the change solves it. For a bug, the test that reproduces it. A plan without them is not finished.
- Size: an estimate in lines. If it passes about 400 lines or mixes unrelated work, split it into separate PRs and plan the first one.
- Risk tier: low, medium, or high, using the tiers in `verify-before-pr`.

Show the plan with the issue links, and wait for the user's approval. Don't create a branch or spawn a coder before they approve. If the plan changes in a way the user would care about later, update the issues, show the change, and ask again.

## 3. Build through agents

Create a branch. Never work on the default branch.

Hand each issue to its agent with a spec, as `model-roles` describes. Include the issue's "Done when" list in the spec. For a bug fix, the first piece is the failing test: have the coder write it and show it failing before the fix.

Read each agent's report and diff before you accept it. Send corrections to the same agent with SendMessage. Don't fix the code yourself.

Commit on the branch in small steps, with messages that follow `git-messages`. Branch commits don't need the user's approval.

## 4. Verify

Run the `verify-before-pr` skill. It runs the project's checks and every check on each issue's "Done when" list. Do not skip it because the change looks small.

## 5. Review

Run the `pr-review` skill once, on the full diff against the default branch. It spawns fresh-context `model-policy:reviewer` agents from the main session. Don't hand the whole review to one agent, because a subagent can't start agents of its own. Pick the depth from the risk tier: low gets quick, medium gets standard, and high gets deep.

## 6. Address findings

Run the `address-review-findings` skill on the review report. Fixes go to a coder, never to a reviewer. After the fixes, run the checks from step 4 again. The review does not run again.

If a fix changes the approach or grows the diff by much, tell the user and let them decide whether it needs another review.

## 7. Open the PR and get it approved

Push the branch and open a PR into the default branch, with the title and description `verify-before-pr` wrote. The description closes its issues with `Closes #N` lines. Give the user the link, the risk tier, and a short summary. This is the user's review.

Before merge, confirm:

- If the repo has CI, it is green. If the repo has no CI, skip this check and don't mention it.
- Every review thread has an answer.
- The user approved the PR. An agent's approval never counts as a person's.
- New commits after an approval get approved again.

Merge only after the user approves.

## 8. Record lessons

This is the only step that writes lessons. Each repo has its own LESSONS.md at its root.

Look at what the checks, the review, and the user found. For each mistake worth remembering, add an entry to the repo's LESSONS.md, and create the file if it doesn't exist:

```
## YYYY-MM-DD: <short title>
- What happened: <the mistake, in one sentence>
- Caught by: <the checks, the review, the user, or production>
- Fix: <the lasting fix: a lint rule, a test, a CLAUDE.md or REVIEW.md line, or a skill edit, with a link>
```

If the same mistake is already in LESSONS.md, it has happened before. Propose a lasting fix to the user instead of a second entry.

Commit LESSONS.md on the branch, so it goes into main with the PR.

## 9. Clean up

After the merge, delete the branch, locally and on the remote. Check that the PR closed its issues.

If the merge finishes a checkpoint, close its milestone and tag the version, for example `git tag v0.2.0`. Then plan the next checkpoint from step 2.

If the change later causes a revert or a bug, add a LESSONS.md entry for it, with what the review should have caught.

## Final report

End with a short summary for the user. Include what changed, the check results, the review outcome, the risk tier, the PR link, the issues it closed, and the lessons recorded.
