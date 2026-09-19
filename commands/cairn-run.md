---
description: Run a full Cairn round from this session — one task agent at a time, settled and reviewed by the cairn CLI
---

# Cairn Run

You are the run agent. Your job is to drive one Cairn round to completion from this interactive session: launch a task agent for each task, have the CLI settle it, launch the reviewer when the CLI asks for one, and move on. Every decision about *what* happens next is made by the CLI — you carry out its verdicts.

## Before you start: permission mode

This command cannot set the permission mode; the user picks it when launching the session. A round runs unattended, so:

- **Recommended: `bypassPermissions`.** Containment still holds: the PreToolUse hook that `cairn init` seeds (`cairn hook pre-tool-use`) denies subagent edits to `tasks.json` and scopes the reviewer's writes, and hook denies bind even under bypass.
- **`auto`** can be tried, but its classifier may wrongly deny routine actions (`git commit`, `bun test`, `cairn task ...`), which surface as stalled or blocked tasks.
- **`default` / `acceptEdits`** will stall the round on the first permission prompt nobody is there to answer.

If the session is not in `bypassPermissions` or `auto`, say so in one line, then start anyway.

## The loop

Run `cairn round next` and act on the JSON it prints. Every `cairn round` command prints exactly one JSON object on stdout; each has a `verdict` and a `next` hint. Keep going until a stop condition below.

### `cairn round next` verdicts

- **`task`** — `{ verdict, taskId, title, iteration, model, promptFile, next }`
  1. Launch the **Agent** tool with `subagent_type: "cairn-task-agent"`, `model: <model>`, a short description such as `Task #<taskId>`, and prompt `Read <promptFile> and follow it`.
  2. Remember the agent id the Agent tool returns, keyed by `taskId`.
  3. Run `cairn round settle <taskId>` and act on its verdict.
- **`review`** — `{ verdict, taskId, reviewPromptFile, next }`: handle it exactly like settle's `review` below. (A review left open by a crash or an earlier session is picked up here first.)
- **`round-done`** — `{ verdict, blocked, next }`: send a **PushNotification** with a short summary (tasks settled this session, and `blocked` if non-zero), then **stop**.

If the JSON has a `warnings` array, show each warning to the user once — the first time you see it, not on every call.

### `cairn round settle <taskId>` verdicts

- **`retry`** — `{ verdict, taskId, mode, reason, failure?, promptFile, model, next }`. Every relaunch uses the verdict's `model` and `promptFile` — never values you remember.
  - `mode: "continue"`: **SendMessage** to the task agent id you remembered for this task. Give it the `reason` and the `failure` tail (if present) and ask it to finish the task. Then run `cairn round settle <taskId>` again. If you do not have that agent's id (after compaction, a resume, or a fresh session), launch a fresh `cairn-task-agent` with the verdict's `model` and `promptFile` (`Read <promptFile> and follow it`) instead, and remember its id.
  - `mode: "fresh"`: launch a new `cairn-task-agent` with the verdict's `model` and `promptFile` (`Read <promptFile> and follow it`), remember its id, then run `cairn round settle <taskId>`.
- **`review`** — `{ verdict, taskId, reviewPromptFile, next }`: launch the **Agent** tool with `subagent_type: "post-task-reviewer"` and prompt `Read <reviewPromptFile> and follow it`. It returns one line (`PASS` or `CONCERNS ...`). Then run `cairn round settle <taskId> --reviewed`.
- **`blocked`** — `{ verdict, taskId, reason, next }`: send a **PushNotification** with the task id and a one-line version of `reason`, then run `cairn round next`. Never pause the round to ask the user — do not use AskUserQuestion.
- **`done`** or **`already-settled`**: run `cairn round next`.

### When a command fails

A `cairn round` command exits 0 for every verdict, `blocked` and `already-settled` included. A **non-zero exit** means the command itself could not run (unreadable `tasks.json`, lock timeout, unknown task id). Send a **PushNotification** with its stderr line and **stop** — do not retry, work around it, or repair files yourself.

## Rules

- **One agent at a time.** Never launch agents in parallel. Never nest them: you launch the reviewer, the task agent never does.
- **The CLI owns state.** Never read `tasks.json`, diffs, or test logs yourself, and never edit `tasks.json`. Everything you need is in the JSON verdicts; everything an agent needs is in its prompt file.
- **Follow `next`.** When unsure what to do, do what the latest verdict's `next` hint says. That hint is the same whether this session is fresh, resumed, or compacted, so the round behaves identically in all three.
- **Stay terse.** A round can run ~20 tasks; it must fit without leaning on compaction. Don't restate agent output or JSON — at most one short line per step (e.g. `#12 done`, `#13 retry (validation-failed)`). Task agents return at most 5 lines and the reviewer one; don't ask them for more.
