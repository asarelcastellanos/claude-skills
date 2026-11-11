---
name: model-roles
description: "Use for any coding task. Opus is the orchestrator: it plans, delegates, and supervises. Sonnet writes and reviews code, Haiku does lookups and mechanical edits, and no subagent runs on Opus. The model-policy mod enforces this, so read it before you spawn an agent, edit a code file, or write a file from the shell."
---

# Model roles

Opus 5.5 is the orchestrator. It runs only as the main session, where it plans, delegates, and supervises. Sonnet 5.5 writes and reviews code. Haiku 5.5 answers lookups and makes mechanical edits. Pick the cheapest agent that can do the job:

| Job | Agent | Model |
|---|---|---|
| Find files, list callers, read docs, run tests and report | `model-policy:scout` or `Explore` | Haiku |
| Edits the spec spells out completely: renames, imports, moving code | `model-policy:mechanic` | Haiku, or Sonnet if set in `/config` |
| Code that needs any decision | `model-policy:coder` | Sonnet |
| Review a diff, verify a finding | `model-policy:reviewer` | Sonnet |
| Plans, docs, READMEs, GitHub issue and PR bodies, release notes | `model-policy:coder` | Sonnet |

The `model-policy` mod in `mods/model-policy/` enforces this:

- It sets the model on every agent, including Workflow agents. No agent runs on Opus. Agents that ask for Haiku keep it. `Explore`, the scout, and the mechanic get Haiku unless the call asks for Sonnet. Every other agent gets Sonnet, even if it asks for Opus.
- It blocks the main session from editing code files and Markdown or text files (`.md`, `.mdx`, `.markdown`, `.txt`), through Edit and Write, and through shell writes such as `sed -i`, `tee`, and `>` redirects. The one exception is the auto-memory directory, `~/.claude/projects/*/memory/`. Subagents are not blocked.
- It denies every fork, because a fork always runs on the main session's model and shares its context.

These rules tell you how to work with it, so it never has to block you.

## Main session (Opus)

- Plan the change. Read only the files you need to decide how to make it.
- Send questions about the code ("where is X handled", "find every caller of Y", "do the tests pass") to `model-policy:scout` or `Explore`. They run on Haiku and return the answer without filling your context with file dumps.
- Hand each piece of code work to a `model-policy:coder` agent with a spec. Independent pieces can go to several coders at once.
- Hand a mechanical edit to `model-policy:mechanic` only when the spec names every change. If it reports `Needs coder:`, send that step to a coder.
- Write only short text yourself: memory notes, agent specs, and chat replies.
- Send long writing to a `model-policy:coder` agent with an outline: plans, READMEs, docs, issue and PR bodies, release notes. Send an exact small edit to an existing doc to `model-policy:mechanic`.
- Review the result against `unslop` and the source plan before it is published or posted.
- Read the coder's report and the diff before you accept the work. Send corrections to the same coder with SendMessage. It keeps its context, so a follow-up costs less than a new agent.

## Write a spec a coder can finish

A coder knows only its prompt. Include:

- The goal in one or two sentences.
- The files to change, and the files to read first.
- The exact behavior: inputs, outputs, error cases, and names to use.
- What not to touch.
- The checks to run before it reports back.

If you can't write that spec, you haven't finished planning. The coder reports in a fixed format: Changed, Checks, Questions, Notes. Answer its questions before you review the code.

## Review (Sonnet)

- Use `model-policy:reviewer` for every review agent: the finders and verifiers in `pr-review`. It has no edit tools.
- A reviewer's value comes from fresh context. Give it the diff and the intent, never your reasoning or your opinion of the code.
- Fixes for what a reviewer finds go to a coder, never to the reviewer.
- You still read every diff and every review yourself before you accept it. Supervising is your job.

## Model picker

When a new session starts, the mod asks which model to use: Opus, Sonnet or Haiku. The pick becomes the main model, as if the user had typed `/model`. If the session already runs on the picked model, or a variant of it such as `opus[1m]`, the mod leaves it alone. If the switch fails, the mod says so in the transcript. A resumed session and `/clear` do not ask. Closing the question keeps the current model. A `-p` run never asks, and neither does a session with `/model-policy off`.

The mod reads the main model each time an agent starts. When the main session runs on Haiku, every agent runs on Haiku, coders and reviewers included. That holds however the session got onto Haiku: the picker, `/model`, or `--model haiku`. On Sonnet or Opus, agents run as the table above says. Opus never runs as an agent.

The `askModelAtStart` setting in `/config` turns the question off.

## Near your subscription limit

From 95% of the 5-hour limit, starting a Workflow needs the user's confirmation. From 80%, `session-coach` halves its Workflow agent cap. Both thresholds are settings in `/config`.

## Workflows

Workflow agents default to the main session's model, Opus. The mod moves every one of them to Sonnet unless it asks for Haiku. Pass `model: 'haiku'` for cheap stages such as listing files or summarizing. Pass `agentType: 'model-policy:reviewer'` to review `agent()` calls so they get the reviewer's rules.

## Turn it off

`/model-policy off` turns the mod off for the current session, and `/model-policy on` turns it back on. `/model-policy` shows whether it's on and how many tokens each model used this session. `/model-policy week` shows the last seven days by model and by agent type. Use it to decide whether the mechanic should stay on Haiku.
