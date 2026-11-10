# Lessons

Mistakes worth remembering, newest first. Step 8 of the `ship-a-change` skill adds entries. When a mistake shows up here twice, it needs a lasting fix instead of a second entry.

## 2026-11-10: Shell-write detection built from regexes keeps breaking
- What happened: `isFileWrite` in the `model-policy` mod matched shell syntax with regexes. Review round 1 found ten false positives and misses. Round 2 found four more: chained commands, redirects read as file names, and `<<` inside quotes or arithmetic.
- Caught by: review rounds 1 and 2
- Fix: split commands into simple commands before checking, with a test for every command a review reported. If a third round finds more, replace the regexes with a real shell tokenizer.

## 2026-11-10: A skill and the code it describes said different things
- What happened: the `model-roles` skill and `reviewer.md` said reviews run on Sonnet while `policy.ts` still sent them to Opus. The Markdown changed first and the code change waited for a later round.
- Caught by: review round 1
- Fix: change a policy's skill text and its code in the same commit. A reviewer checks that they agree.

## 2026-11-10: A Workflow started without the user asking for one
- What happened: the main session started the round-2 review as a Workflow. The session rule allows Workflows only when the user asks for one.
- Caught by: the main session, after the fact
- Fix: `pr-review` spawns reviewer agents with the Agent tool. Use a Workflow only when the user asks for one.
