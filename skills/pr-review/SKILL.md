---
name: "pr-review"
description: "Use to review a diff or PR for real bugs. Parallel agents find bugs, separate agents verify them, and re-reviews stop after three rounds."
---

# PR review

The main session runs this skill and spawns every reviewer itself. A subagent can't start agents of its own, so never hand this whole skill to one agent. Each finder and verifier is a fresh-context `model-policy:reviewer` agent, as the `model-roles` skill describes. Spawn them with the Agent tool. Use a Workflow only when the user asks for one.

Catching real bugs comes first. Reducing review rounds comes second. Noise is expensive. When an agent wrote the change, every nit costs another commit and another round.

## Inputs

Collect these before you review:

- The diff against the base branch.
- The intent, from the PR description, the linked issue, or what the user asked for.
- The repo's CLAUDE.md and REVIEW.md, if they exist. REVIEW.md rules override the defaults in this skill.
- The round number. Round 1 is the first review of this change.

## Depth

Pick a depth from the risk of the change, or use the depth the user names.

- Quick. One reviewer agent reviews in one pass, with every lens. Use it for docs, copy, and small low-risk changes.
- Standard. Three finder agents, then one verifier per finding. This is the default.
- Deep. Five finder agents, then three verifiers per finding. Use it for auth, billing, data migrations, CI workflows, installers, and code where one missed bug is costly.

## Phase 1. Understand the change

Read the intent. Read the code around the diff, including callers of changed functions. Then answer these questions:

- Does the change solve its stated problem?
- Does it fit how the rest of the system works?
- Does it break anything else?
- For a bug fix, does it fix the root cause?

## Phase 2. Find candidate bugs in parallel

Spawn the finder agents at the same time. Give each one the diff, the intent, and one lens:

1. Logic and edge cases. Off-by-one errors, null or empty input, wrong conditions, unhandled states.
2. Integration. Callers, contracts, and schemas that the change breaks.
3. Errors and state. Error handling, concurrency, resource leaks, data loss, partial failure.
4. Security. Injection, missing auth checks, leaked secrets, unsafe input. Use /security-review if it is available.
5. Tests. Whether the tests exercise the changed behavior and would fail without the change.

Standard depth uses lenses 1 to 3. Deep depth uses all five.

Each candidate needs a file and line, the defect in one sentence, and a concrete failure scenario. A failure scenario names an input or state and the wrong result it produces. A guess from a function name is not evidence. The finder must read the code.

## Phase 3. Verify

Merge duplicate candidates first. Then, for each candidate, spawn verifier agents with fresh context. Give them the finding and access to the code. Do not give them the finder's reasoning. Each verifier votes CONFIRMED, REFUTED, or UNSURE with a one-line reason.

Keep a finding only if a majority votes CONFIRMED. With one verifier, keep it only if that verifier votes CONFIRMED.

Drop style, formatting, naming, and cleanup suggestions unless REVIEW.md asks for them.

## Phase 4. Tag

Tag each finding that survived:

- Important. A real bug or risk the author should fix before merge.
- Nit. Minor and safe to skip. Report three at most.
- Pre-existing. A real bug in code this change did not introduce. Never blame the author for it.

Sometimes several findings are the same kind of mistake. Report that mistake once as a bug class and list every instance. The author can then fix all of them in one pass.

## Phase 5. Report

Open with the count, for example "2 important, 1 nit, 1 pre-existing." If nothing survived, write "No issues found. Nothing needs fixing." and stop.

List the findings sorted by severity. For each one, give the tag, the file and line, the defect, the failure scenario, and a suggested fix.

## Re-review rules

- From round 2 on, review only what changed since the last review.
- Never repeat a finding from an earlier round, whether the author fixed it or rejected it with a reason.
- After round 3, if Important findings remain, stop listing new findings. Tell the author the approach may be wrong and ask them to reconsider it, or escalate to the user.

## If the repo has no REVIEW.md

Offer to draft one. A good REVIEW.md is short. It covers these points:

- What failure looks like in this repo, for example "the API returns wrong totals."
- Paths to skip, such as generated code or vendored files.
- Paths that always need a person, such as auth, billing, and CI workflows.
- The nit cap.
- A rule that every finding needs a file and line.