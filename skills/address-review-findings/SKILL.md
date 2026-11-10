---
name: "address-review-findings"
description: "Use when you respond to code review findings on your own change. Every finding gets an answer, and you escalate to the user after three rounds."
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

Before you fix a finding, search the change and nearby code for the same mistake. Fix every instance in one pass. Otherwise the next round finds the same bug in a different place.

## 3. Handle pre-existing findings

A pre-existing finding is a bug the change did not introduce. Fix it only if the fix is small and fits the scope of the change. Otherwise list it as a follow-up for the user. Do not let it grow the PR.

## 4. Verify again

After you fix, run the checks from the `verify-before-pr` skill again. That means the tests, type checks, linter, build, and end-to-end check. Show the output.

## 5. Stop loops early

Count the rounds. Stop after round 3 if Important findings remain. Also stop if each round finds new bugs in the same area. Tell the user the approach may be wrong, summarize what keeps failing, and suggest another approach. Closing a PR and starting over is cheap when the code was fast to write.

## 6. Fix recurring findings at the source

Add each mistake worth remembering to LESSONS.md, as step 8 of `ship-a-change` describes. If LESSONS.md shows the mistake has come up before, propose a lasting fix to the user. The fix can be a lint rule, a line in CLAUDE.md or REVIEW.md, or an edit to a skill.

## 7. Report

End with a table of every finding and its outcome. Then give the check results and any follow-ups.

| Finding | Tag | Outcome | Note |
|---|---|---|---|