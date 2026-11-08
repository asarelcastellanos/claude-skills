---
name: "ship-a-change"
description: "Use for any coding task you carry from request to merged PR. It walks eight steps and runs verify-before-pr, pr-review, and address-review-findings at the right points."
---

# Ship a change

This skill is the full process for one code change. It calls three other skills. If one of them is missing, follow the step as written here and tell the user which skill was missing.

Create a task list with the eight steps below at the start. Tick each one off as you finish it.

## 1. Understand the task

Restate the request in one or two sentences. Read the repo's CLAUDE.md and REVIEW.md if they exist. Read the code you will touch and its callers before you change anything.

Ask the user a question only if a wrong guess would be expensive to undo. Otherwise pick the most reasonable reading, state it, and continue.

## 2. Plan a small change

Decide the approach. For anything beyond a small fix, write two or three candidate approaches in a few lines each and pick one with a reason.

Estimate the size. If the change will pass about 400 lines or mix unrelated work, split it into separate PRs and do them one at a time.

Note the risk tier now, using the tiers in `verify-before-pr`. A high-risk change needs a person to review it before merge, so tell the user early.

Create a branch. Never work on the default branch.

## 3. Build with tests

For a bug fix, write a test that reproduces the bug and watch it fail before you fix anything. For a feature, write tests for the new behavior alongside the code.

Put new behavior behind a feature flag when the project has flags and the change is user-facing.

Commit in small steps. Write each message with the `git-messages` skill, and show it to the user before you commit.

## 4. Verify

Run the `verify-before-pr` skill. Do not skip it because the change looks small.

## 5. Review

The `verify-before-pr` skill spawns a fresh-context reviewer that runs the `pr-review` skill. Pick the review depth from the risk tier. Low risk gets quick, medium gets standard, and high gets deep.

## 6. Address findings

Run the `address-review-findings` skill on the review report. After fixing, run `pr-review` again on the new diff only.

Repeat steps 5 and 6 for at most three rounds. If Important findings remain after round 3, go back to step 2. Tell the user the approach may be wrong and propose another one.

## 7. Open the PR and merge

Show the PR title and the description `verify-before-pr` wrote, and open the PR after the user approves them. Confirm these before merge:

- CI is green.
- Every review thread has an answer.
- The approvals match the risk tier. An agent's approval never counts as a person's.
- New commits after an approval get approved again.

Do not merge on your own unless the user told you to. Report the PR link and its status.

## 8. Learn from it

Look at what the reviews found. If a finding is a mistake that has happened before, propose a lasting fix to the user. That can be a lint rule, a line in CLAUDE.md or REVIEW.md, or an edit to one of these skills.

If the change later causes a revert or a bug, save it as a test case for the reviewer. Write down the bug, the file and line, and what the review should have caught.

## Final report

End with a short summary for the user. Include what changed, the check results, how many review rounds it took, the risk tier, the PR link, and any follow-ups.