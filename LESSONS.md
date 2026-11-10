# Lessons

Mistakes worth remembering, newest first. Step 8 of the `ship-a-change` skill adds entries. When a mistake shows up here twice, it needs a lasting fix instead of a second entry.

## 2026-11-10: Monitor rows overflowed the 40-column dock
- What happened: rows in the session-monitor pane drew wider than the pane at narrow widths. Each fix covered the rows a review had named, and the next round found others.
- Caught by: review rounds 1 to 4 of the monitor restyle
- Fix: tests now render the fixed rows at 23 columns and up. Proposed lasting fix: one shared test helper that renders the whole pane at 23, 30, 34 and 40 columns and fails on any row wider than the pane.

## 2026-11-10: Shell-write detection built from regexes keeps breaking
- What happened: `isFileWrite` in the `model-policy` mod matched shell syntax with regexes. Review round 1 found ten false positives and misses. Round 2 found four more: chained commands, redirects read as file names, and `<<` inside quotes or arithmetic.
- Caught by: review rounds 1, 2, and 3. Round 3 ran about 280 commands and found six more writes that got through.
- Fix: a table-driven regression test holds every command any review reported. The check is now labeled best-effort, and the `model-roles` skill is the primary rule. Proposed lasting fix, for a follow-up PR: replace the regexes with a small shell tokenizer bundled into the mod.

## 2026-11-10: A skill and the code it describes said different things
- What happened: the `model-roles` skill and `reviewer.md` said reviews run on Sonnet while `policy.ts` still sent them to Opus. The Markdown changed first and the code change waited for a later round.
- Caught by: review round 1
- Fix: change a policy's skill text and its code in the same commit. A reviewer checks that they agree.

## 2026-11-10: A Workflow started without the user asking for one
- What happened: the main session started the round-2 review as a Workflow. The session rule allows Workflows only when the user asks for one.
- Caught by: the main session, after the fact
- Fix: `pr-review` spawns reviewer agents with the Agent tool. Use a Workflow only when the user asks for one.
