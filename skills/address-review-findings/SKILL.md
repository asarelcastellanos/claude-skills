---
name: "address-review-findings"
description: "Use when you respond to code review findings on your own change. Every finding gets an answer, fixes cover the whole class of mistake, and the checks run again."
---

# Address review findings

Use this when a reviewer reports findings on a change you wrote. The reviewer can be a person or an agent.

## 1. Answer every finding

Give each finding one outcome. Never skip a finding.

- Fixed. Say what changed.
- Rejected as wrong. Show the evidence, such as the line that handles the case or a test that proves it.
- Intentional. Explain why the behavior is wanted.
- Doesn't matter. Explain why the impact is small enough to ignore.

Check each finding before you fix it. Reviewers make mistakes. Do not apply a fix you believe is wrong just to close the comment.

## 2. Fix the whole class

Before you fix a finding, search the change and nearby code for the same mistake. Fix every instance in one pass, so no copy of the bug stays behind.

## 3. Handle pre-existing findings

A pre-existing finding is a bug the change did not introduce. Fix it only if the fix is small and fits the scope of the change. Otherwise list it as a follow-up for the user. Do not let it grow the PR.

## 4. Verify again

After you fix, run the checks from the `verify-before-pr` skill again. That means the tests, type checks, linter, build, each issue's "Done when" checks, and the end-to-end check. Show the output.

The review does not run again. If a fix changes the approach or grows the diff by much, tell the user and let them decide whether it needs another review.

## 5. Report

End with a table of every finding and its outcome. Then give the check results and any follow-ups. Mistakes worth remembering go into LESSONS.md at step 8 of `ship-a-change`, not here.

| Finding | Tag | Outcome | Note |
|---|---|---|---|
