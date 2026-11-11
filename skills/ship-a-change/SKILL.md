---
name: "ship-a-change"
description: "Use for a coding task worth a plan and a review, carried from request to merged PR. It walks nine steps: GitHub issues track the work, the user approves the plan and the final PR, Sonnet and Haiku agents do the work, and the main session supervises."
---

# Ship a change

This skill is the full process for one code change. The main session (Opus) runs it as the orchestrator: it plans, delegates, and supervises. Agents do the work, as the `model-roles` skill describes. The user approves twice, once for the plan and once for the PR into main.

It calls `model-roles`, `verify-before-pr`, `pr-review`, `address-review-findings`, and `git-messages`. If one of them is missing, follow the step as written here and tell the user which skill was missing.

## When to use it

Using the full process is a judgment call. Use it when a wrong change would cost time to undo, when the change touches several files or behaviors, or when the user asks for it.

A small, clear change skips the plan and the review. Examples are a one-line fix, a setting, a copy edit, or a change the user spelled out exactly. Make the change through the right agent on a branch, run the checks, and open a PR with a `git-messages` description. The user still approves the merge. Tell the user in one line that you skipped the process, so they can ask for it.

Two rules apply even when you skip the process:

- A reported failure always gets an issue and a reproduction first, as "When the user reports a failure" below describes.
- Changes reach the default branch only through a PR the user approves.

When you use the process, create a task list with the nine steps below and tick each one off as you finish it.

### Without GitHub

The process tracks work in GitHub issues through `gh`. If the repo has no GitHub remote, has issues turned off, or `gh` is not signed in, tell the user once. Then keep the same structure in text: number the pieces of work in the plan, give each one its "Done when" list, and list them in the PR description in place of `Closes #N` lines.

## 1. Understand the task

Restate the request in one or two sentences. Read the repo's CLAUDE.md, REVIEW.md, and LESSONS.md if they exist.

Send questions about the code to `model-policy:scout` or `Explore`: where something is handled, who calls a function, whether the tests pass today. Read the key files yourself only when you need them to decide the approach.

The vaguer the request, the more questions you ask:

- A clear request names the goal, the scope, and the result. Ask at most one question about it.
- A vague request is missing one of those. Ask until you can name the goal, what is in and out of scope, and the checks that will prove it's done. Ask in rounds of a few questions with AskUserQuestion, and offer options where you can.
- Never plan around a guess about what the user wants. Keep the answers, and write each one into the issue it affects when you create the issues in step 2.

### When the user reports a failure

When the user says something fails, breaks, or behaves differently than they expect, do this before you investigate or fix anything, even when the fix looks small:

1. Have a `model-policy:coder` write a GitHub issue that states the report in the user's words, from your outline. The coder writes the body to a file in the session scratchpad (a temp dir if none is named) and reports the path under "Notes". Review the file against `unslop` and the report, then create the issue with `gh issue create --body-file`.
2. Try to reproduce it. Have a `model-policy:scout` run the steps, or run them yourself.
3. Record the attempt on the issue with `gh issue comment`: the steps, what was expected, what happened, and whether it reproduced. Paste the relevant output. Remove tokens, keys, and personal data from it first. For a screenshot, describe it in the comment and ask the user to attach the image.
4. Add a "Done when" list to the issue. Its first check is the reproduction, which must now pass.

If it doesn't reproduce, say so on the issue, ask the user what differs on their side, and wait for the answer before you plan. Don't fix what you can't reproduce.

This issue is the issue for the fix. Step 2 adds to it and doesn't create a second one.

### Large or vague tasks

If the task is large, or too vague to plan in one pass, split it into checkpoints before you plan. A checkpoint is a point the user can see and test. Each one is a GitHub milestone, and every issue sits in one milestone.

Offer the user three checkpoint styles that fit the task, with the one you recommend first. Versioning is always one of the three. Pick the other two from this list:

- Versions. Each checkpoint is a minor version. If the project already has a version (in package.json, a plugin manifest, or git tags), continue from it: a project at 2.3.1 has checkpoints 2.4.0, 2.5.0, and so on. A project with no version starts at 0.1.0, and the last checkpoint is 1.0.0. If the project keeps its version in a file, each merged PR inside a checkpoint bumps the patch number there (2.4.1, 2.4.2).
- Vertical slices. Each checkpoint delivers one thing a user can do from end to end, such as "sign up" and then "reset a password". Fits product features.
- Phases. Each checkpoint is a named stage, such as prototype, working version, polish, and release. Fits work where the shape is still unknown.
- Risk first. The first checkpoint answers the riskiest open question with a small spike, and later checkpoints build on what it proved. Fits vague or experimental tasks.
- Time boxes. Each checkpoint is what fits in a fixed period, such as one week, with the issues ranked so the most important ones land first. Fits open-ended work with a deadline.

Once the user picks a style, create the milestones and a project board:

- `gh` has no milestone command. Create each milestone with `gh api repos/{owner}/{repo}/milestones -f title="<name>"`, and name it after the task as well as the checkpoint, such as "Billing 2.4.0" or "Billing: prototype".
- Create the board with `gh project create --owner <owner> --title "<task>"`, link it with `gh project link`, and add each issue with `gh project item-add`. These need the `project` scope. If `gh` reports it missing, ask the user to run `gh auth refresh -s project`, and continue without the board until they do.

Each checkpoint also gets a branch, which step 3 creates. Name it `release/<version>` for the versions style and `checkpoint/<short-name>` for the other styles.

Show the checkpoints with the plan for the first one.

## 2. Plan, track, then get the plan approved

Create one GitHub issue for each piece of work, with `gh issue create`, unless a reported failure already has its issue. Do not write the issue bodies yourself. Send an outline of each issue to a `model-policy:coder`. The outline holds the goal, the user's answers from step 1 that affect the issue, and its "Done when" list: the tests or checks that prove the issue is solved. The coder writes each body to a file in the session scratchpad (a temp dir if none is named) and reports the paths under "Notes". Review each file against `unslop` and your outline, then create the issue with `gh issue create --body-file`. Put each issue in its checkpoint's milestone and on the project board, if the task has them.

Outline the plan in this shape, and send the outline to a `model-policy:coder` to write up. The coder writes the plan to a file in the session scratchpad (a temp dir if none is named) and reports the path under "Notes". Review the file against `unslop` and your outline before you show it:

- Goal: one or two sentences.
- Approach: for anything beyond a small fix, two or three options in a line each, and the one you picked with the reason.
- Issues: each issue's number and title, the agent that does it (`model-policy:coder`, `model-policy:mechanic`, or `model-policy:scout`), and which can run in parallel under the rule in step 3.
- Tests: for each issue, the tests or checks that prove the change solves it. For a bug, the test that reproduces it. A plan without them is not finished.
- Size: an estimate in lines. If it passes about 400 lines or mixes unrelated work, split it into separate PRs and plan the first one.
- Risk tier: low, medium, or high, using the tiers in `verify-before-pr`.

Show the plan with the issue links, and wait for the user's approval. Don't create a branch or send code work to a coder before they approve. If the plan changes in a way the user would care about later, update the issues, show the change, and ask again.

## 3. Build through agents

Create a branch. Never work on the default branch.

A task with checkpoints gets one branch per checkpoint, cut from the default branch and named as step 1 says. Cut each feature branch from the checkpoint branch, and point its PR at the checkpoint branch, not the default branch. A single change with no checkpoints keeps one branch and one PR into the default branch.

Hand each issue to its agent with a spec, as `model-roles` describes. Include the issue's "Done when" list in the spec. For a bug fix, the first piece is the failing test: have the coder write it and show it failing before the fix.

Build independent issues in parallel. Give each one its own agent on its own branch, then merge the branches into the working branch one after another. Do this only when the issues touch different files and none depends on another's changes. If they share files or depend on each other, or if you can't tell, build them one at a time. After each merge, run the checks before you merge the next branch.

Read each agent's report and diff before you accept it. Send corrections to the same agent with SendMessage. Don't fix the code yourself.

Merge a feature PR into a checkpoint branch when its checks are green and you have read its diff. The user's approval of the plan covers that merge. Then delete the feature branch, locally and on the remote. After every merge, run the project's full checks on the checkpoint branch before you merge anything else. A red checkpoint branch blocks every further merge until it is fixed. If the repo has CI, make it run on PRs into checkpoint branches as well as the default branch.

Commit on the branch in small steps, with messages that follow `git-messages`. Branch commits don't need the user's approval.

## 4. Verify

Run the `verify-before-pr` skill. It runs the project's checks and every check on each issue's "Done when" list. Do not skip it because the change looks small.

## 5. Review

Run the `pr-review` skill once, on the full diff against the default branch. It spawns fresh-context `model-policy:reviewer` agents from the main session. Don't hand the whole review to one agent, because a subagent can't start agents of its own. With checkpoints, the review covers the checkpoint branch's full diff against the default branch, once, before the PR into the default branch. It doesn't cover the feature PRs one by one. Pick the depth from the risk tier: low gets quick, medium gets standard, and high gets deep.

## 6. Address findings

Run the `address-review-findings` skill on the review report. Fixes go to a coder, never to a reviewer. After the fixes, run the checks from step 4 again.

The review doesn't run again, with one exception. If a finding shows the approach is wrong, or a fix adds more than about 100 lines or touches files outside the reviewed diff, go back to step 2. Update the issues, show the user the new plan, and after the fix, review only the fix's diff.

## 7. Record lessons

This is the only step that writes lessons. Each repo has its own LESSONS.md at its root.

Look at what the checks, the review, and the user found. For each mistake worth remembering, write the exact entry text in this form. Send it to a `model-policy:mechanic`, which adds it to the repo's LESSONS.md and creates the file if it doesn't exist. The mechanic does not commit:

```
## YYYY-MM-DD: <short title>
- What happened: <the mistake, in one sentence>
- Caught by: <the checks, the review, the user, or production>
- Fix: <the lasting fix: a lint rule, a test, a CLAUDE.md or REVIEW.md line, or a skill edit, with a link>
```

If the same mistake is already in LESSONS.md, it has happened before. Propose a lasting fix to the user instead of a second entry.

Commit LESSONS.md on the branch yourself with `git commit`, before you open the PR, so the user approves it with the rest.

A bug that an earlier merged change caused gets its lesson here too, in the PR that fixes it. Say what the earlier review should have caught.

## 8. Open the PR and get it approved

Before you open the PR, have a `model-policy:coder` update the description file `verify-before-pr` had written so it matches the final diff, including the fixes from step 6. Review the file against `unslop` and the diff. Push the branch and open a PR into the default branch with `gh pr create --body-file` and that file. It closes its issues with `Closes #N` lines. With checkpoints, this is the PR from the checkpoint branch, and its lines cover every issue merged into it, because GitHub closes an issue only when a PR reaches the default branch. Give the user the link, the risk tier, and a short summary. This is the user's review.

Before merge, confirm:

- If the repo has CI, it is green. If the repo has no CI, skip this check and don't mention it.
- Every review thread has an answer.
- The user approved the PR. An agent's approval never counts as a person's.
- New commits after an approval get approved again.

Merge only after the user approves.

## 9. Clean up

After the merge, delete the branch, locally and on the remote. With checkpoints, that is the checkpoint branch. Check that the PR closed its issues.

If the merge finishes a checkpoint, close its milestone with `gh api -X PATCH repos/{owner}/{repo}/milestones/<number> -f state=closed`. With versions as the style, also tag it: check out the default branch, pull, run `git tag v<version>`, and push the tag with `git push origin v<version>`. Before you push a tag, check whether the repo's CI publishes on tags, and ask the user first if it does.

If more checkpoints remain, cut the next checkpoint branch from the updated default branch and plan the next one from step 2. If that was the last one, tell the user the task is done.

## Final report

End with a short summary for the user. Include what changed, the check results, the review outcome, the risk tier, the PR link, the issues it closed, and the lessons recorded.
