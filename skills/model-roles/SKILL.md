---
name: model-roles
description: "Use for any coding task. Opus plans, supervises, and reviews. Sonnet writes all code and runs every subagent task except code review. The model-policy mod enforces this, so read it before you spawn an agent, edit a code file, or write a file from the shell."
---

# Model roles

Opus 5.5 plans, supervises, and reviews. Sonnet 5.5 writes all code and does every subagent task except code review.

The `model-policy` mod in `mods/model-policy/` enforces this:

- It sets the model on every agent, including Workflow agents. Review agents get Opus and every other agent gets Sonnet.
- It blocks the main session from editing code files, through Edit and Write, and through shell writes such as `sed -i`, `tee`, and `>` redirects.
- It denies forks that aren't reviews, because a fork always runs on the main session's model.

These rules tell you how to work with it, so it never has to block you.

## Main session (Opus)

- Plan the change. Read only the files you need to decide how to make it.
- Send broad searches ("where is X handled", "find every caller of Y") to an `Explore` agent. It runs on Sonnet and returns the answer without filling your context with file dumps.
- Hand each piece of code work to a `model-policy:coder` agent with a spec. Independent pieces can go to several coders at once.
- You may write Markdown and text files: plans, docs, notes, memory.
- Read the coder's report and the diff before you accept the work. Send corrections to the same coder with SendMessage. It keeps its context, so a follow-up costs less than a new agent.

## Write a spec a coder can finish

A coder knows only its prompt. Include:

- The goal in one or two sentences.
- The files to change, and the files to read first.
- The exact behavior: inputs, outputs, error cases, and names to use.
- What not to touch.
- The checks to run before it reports back.

If you can't write that spec, you haven't finished planning. The coder reports in a fixed format: Changed, Checks, Questions, Notes. Answer its questions before you review the code.

## Review (Opus)

- Use `model-policy:reviewer` for every review agent: `pr-review` finders and verifiers, and the fresh-context review in `verify-before-pr`. It runs on Opus and has no edit tools.
- Any agent whose description starts with "review", or whose type contains "review", also runs on Opus.
- Fixes for what a reviewer finds go to a coder, never to the reviewer.

## Workflows

Workflow agents default to the main session's model, Opus. The mod moves every one of them to Sonnet unless it is a review agent. Pass `agentType: 'model-policy:reviewer'` to each review `agent()` call so it keeps Opus. Don't rely on the label, which may not reach the mod.

## Turn it off

`/model-policy off` turns the mod off for the current session, and `/model-policy on` turns it back on. `/model-policy` shows whether it's on and how many tokens each model used this session. The status line shows the same numbers.
