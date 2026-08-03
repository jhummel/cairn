## Context

This round renames the project **Ralph → Cairn**. The name started as a nod to the Ralph Wiggum Loop; the tool has outgrown the joke.

Scope in this repo: **~1,136 occurrences** of `ralph` (case-insensitive) outside the completed-task archive and iteration logs. Source is ~4.4k LOC (`src/`), tests ~10.7k LOC (`test/`). Most of the raw count is in tests.

**Six projects consume Ralph, all through one shared binary.** This is the dominant constraint on the whole plan.

| Project | Tasks | State | Installed `.claude/` | Hooks | `.ralph/` tracked files |
|---|---|---|---|---|---|
| karaoke-platform | **2 pending** | id 9140, round 31 | 4 agents + 3 cmds | yes | 57 |
| karaoke-reservation | 0 | id 147, round 7 | 4 agents + 3 cmds | yes | — |
| karaoke-kiosk | 0 | id 124, round 9 | 4 agents + 3 cmds | no | — |
| karaoke-remote | 0 | id 9, round 5 | 4 agents + 3 cmds (1 stale) | no | — |
| lyrical-pitch-reservations | 0 | **no state.json** | none (custom agent only) | yes | — |
| ralph (this repo) | 0 | id 31, round 4 | 4 agents + 3 cmds | yes | — |

### Reference tiers

**Load-bearing — breaks the tool if wrong:**
- **Data dir `.ralph/`** — hardcoded at `src/index.ts:36`; also the *project-root discovery anchor* (`src/utils.ts:49`).
- **Config file `ralph.json`** — read at `src/config.ts:10`, written at `src/commands/init.ts:185`.
- **Binary name** — `package.json` (`name`, `--outfile dist/ralph`); `install.sh:29` symlinks `~/.local/bin/ralph`.
- **`RALPH_*` env vars** — 22 distinct names.
- **Narration socket `/tmp/ralph-tts.sock`** — `src/commands/init.ts:228,252,271`, installed `.claude/hooks/*.sh`, `lib/ralph_narrate*.py`.
- **Runtime temp-file prefix `.ralph_*`** — a second naming tier *inside* the data dir, independent of the directory name. Several carry live cross-run state (see below).

**Agent-facing prompt text — must match the real binary name:** `src/commands/run.ts:141`, ~20 usage strings in `src/commands/task.ts`, `src/agent-prompt.ts:13`, `agents/*.md`, `commands/*.md`.

**Cosmetic / internal:** `RalphConfig`, `resolveRalphRoot`, `ralphRoot`, `writeRalphJson`, `RALPH_VERSION`.

**Historical record — moves but is never rewritten:** `tasks.completed.json`, `.ralph_iterations.log`, `.ralph_tasks_snapshot.json`, `reviews/round-*.md`, and (in karaoke-platform) 24 committed `.ralph_task_*_notes.md` plus 6 `audit/findings-*.md`.

### Key facts established during exploration

- **`tasks.json` in this repo is empty**; `state.json` is `{ nextTaskId: 31, round: 4 }`. Clean slate here.
- **One symlink serves all six projects.** `~/.local/bin/ralph -> .../ralph/dist/ralph`. Rebuilding cuts every project over simultaneously — there is no staged rollout. The compatibility surface must be **complete before the first rebuild**.
- **`ralph task` is baked into four projects' installed `.claude/agents/*.md`.** Those are frozen copies; they work only while the `ralph` symlink resolves. **The transitional symlink is a long-lived commitment, not a two-week one** — it cannot be dropped until every project is re-inited.
- **`git mv` on a directory moves untracked and ignored files too** — verified empirically: it renames the directory on disk, then stages the tracked renames. A single `git mv .ralph .cairn` handles karaoke-platform's 57 tracked + 5 ignored files, including its gitignored `instructions.md`.
- **The "shell fallback compatibility" comment at `src/config.ts:130` is stale.** `ralph_config.sh` does not exist. The `RALPH_*` vars are internal, with the exceptions below.
- **`RALPH_ANTHROPIC_API_KEY` is live and deliberate.** `lib/ralph_narrate_server.py:222` reads `RALPH_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY`. The main loop blanks `ANTHROPIC_API_KEY` (`run.ts:203`, `plan.ts:170`, `summarize.ts:111`, `post-task-reviewer.ts:119`) to force Max-plan usage; the prefix is what lets narration still reach a real key. **Exported at `~/.zshrc:111` — outside every repo.**
- **`RALPH_NARRATE_SOCKET` is user-facing**, documented at `README:161`.
- `RALPH_TASK_CONTEXT` is live (`run.ts:492`). `RALPH_BIN`/`RALPH_ROOT` are `install.sh`-local shell vars. `RALPH_FORCE_SHELL` is dead — survives only in a stale `.claude/settings.local.json` entry.
- **The `[ralph]` commit prefix is derived** from the directory basename (`run.ts:55`) — renaming the repo folder fixes it for free.
- **Live state lives in `.ralph_*` temp files.** `.ralph_completed_ids` (read by `task-selector.ts:9`), `.ralph_prev_notes` (the `PREV_NOTES` mechanism, `task-archiver.ts:81`), `.ralph_iterations.log` (`logs.ts:5`), `.ralph_tasks_snapshot.json` (corruption recovery, `tasks-file.ts:130`). Switching the code to `.cairn_*` without migrating these files **silently discards that state**. By contrast `.ralph_task_*_notes.md` are write-and-sweep scratch, never read back (`run.ts:685` only regex-matches for deletion).

### Two hazards driving the sequence

**Self-hosting — the binary is hot-swapped every iteration.** This is worse than a single risky step, and the earlier "one hard gate before rebuild" framing of it was wrong. Three facts combine:

1. `dist/` is **gitignored** — `dist/ralph` is a pure build artifact.
2. The health check **is** the build: `healthCheck: "bun run build"` → `bun build --compile src/index.ts --outfile dist/ralph`.
3. It runs **inside every iteration** (`run.ts:507`), before the agent spawns — and agents shell out to `ralph task start/complete` (`run.ts:121,127`), resolving `~/.local/bin/ralph` → `dist/ralph` **fresh on every call**.

So the moment task 1 merges, the next health check overwrites `dist/ralph` with new code and the following iteration's agent runs it. The swap begins at iteration 1 and repeats continuously.

The nastier mode is silent: **the outfile change freezes the binary without erroring.** Once `package.json` points at `dist/cairn`, the health check stops refreshing `dist/ralph`, and `bun build` does not delete the old file — so the symlink keeps resolving to a **stale binary frozen at that moment's code**. Agents quietly run old code for the rest of the round, and any later dependency on newer CLI behavior fails looking like a logic bug rather than a stale build.

**Mitigation (adopted): pin the binary and redirect the health check.** Before the round, freeze `~/.local/bin/ralph` at a copy of the current known-good build, and point `healthCheck` at a throwaway outfile so compilation is still validated without mutating the live binary. The loop's binary is then immutable for all tasks, the round does not depend on dual-read being correct *while it runs*, and there is exactly **one** deliberate rebuild after the loop stops. This removes the mid-loop reinstall gate entirely.

Note: agents cannot test newly-added CLI behavior (e.g. `cairn migrate`) through the pinned binary — they invoke `bun run src/index.ts migrate ...` against a temp fixture instead, which needs no install.

**Reconstructed paths vs. resolved paths.** Under dual-read, discovery may resolve `.ralph/` while `BRAND.dataDir` says `.cairn`. Two sites currently rebuild the path instead of using the `dataDir` already passed around: `src/index.ts:127` (`join(projectRoot, '.ralph', 'tasks.completed.json')`) and `src/post-task-reviewer.ts:137` (the `/${projectRoot}/.ralph/reviews/**` allowlist rule). The second is dangerous — an allowlist for `.cairn/reviews/**` on a project still using `.ralph/` means reviewer writes are **silently denied**, exactly the failure mode last round was spent fixing.

Source-of-truth note (carried): agent definitions live in `agents/` and slash commands in `commands/` at the repo root; `init` installs them into a target project's `.claude/`. Edits target the source dirs; installed copies are refreshed by re-install.

## Goals

1. Rename Ralph → Cairn across code, commands, config, prompts, narration, and docs.
2. Route every name through **one definition** (`src/brand.ts`).
3. **Never break the running loop**, in this repo or the other five.
4. **Preserve the historical record** — archives, logs, review files, and task notes move without a byte changing.
5. Ship **`cairn migrate`** so the other five projects convert in one command plus a short manual pass.
6. Keep a **long-lived compatibility surface**, removable only once all six projects are migrated.

## Approach

- **`src/brand.ts` as single source of truth.** Frozen object: `{ name: 'cairn', displayName: 'Cairn', dataDir: '.cairn', configFile: 'cairn.json', envPrefix: 'CAIRN_', tempPrefix: '.cairn_', socket: '/tmp/cairn-tts.sock' }`. Agent-facing prompt strings become template literals. **Not user-configurable.**

- **`BRAND.dataDir` is for *creating* paths, never *resolving* them.** Anywhere a path must point at an existing project's data, use the resolved `dataDir` threaded from discovery. This is a standing rule for every task in the round, not a one-off fix.

- **Dual-read everywhere state is durable.** Discovery tries `.cairn/` then `.ralph/`; config tries `cairn.json` then `ralph.json`; the four stateful temp files try `.cairn_*` then `.ralph_*`; the notes-sweep regex matches both prefixes. Each logs a one-time legacy warning.

- **Three-way chain for the API key.** `CAIRN_ANTHROPIC_API_KEY` → `RALPH_ANTHROPIC_API_KEY` → `ANTHROPIC_API_KEY`, warning on the legacy name. Required because the var lives in `~/.zshrc` and the failure mode is otherwise quiet.

- **Dual symlink, indefinitely.** Build emits `dist/cairn`; `install.sh` symlinks both `cairn` and `ralph`. Dropping `ralph` is gated on all six projects being re-inited — deliberately *not* part of this round.

- **Pinned binary for the duration of the round.** `~/.local/bin/ralph` points at a frozen copy of the pre-round build; `healthCheck` builds to `/tmp/cairn-healthcheck` instead of `dist/`. Nothing an agent does can change the binary the loop calls. Both are pre-round manual steps and both are reverted after — the health check returns to `bun run build` once the round is done.

- **Compat-first ordering retained even though pinning makes it non-binding in-loop.** Tasks 1–3 still land first so the compatibility surface gets incidental exercise from the 18 tasks that follow, before the post-round rebuild cuts all six projects over at once.

- **`cairn migrate`: non-interactive, idempotent, per-project.** Preflight (refuse on in-progress tasks, warn on dirty tree) → `git mv` the data dir and config → rename the four stateful temp files → rewrite `.gitignore` preserving custom lines → re-install `.claude/` agents and commands → regenerate hooks if present. Must tolerate partial installs. Reuses existing `installAgents`/`installSlashCommands`, which already overwrite via `copyFileSync`.

  Three decisions settled:
  - **Stages everything, commits nothing.** The user reviews before it lands — karaoke-platform's is a 57-file rename. Note this means migrate must explicitly `git add` its non-`git mv` output: the rewritten `.gitignore`, regenerated hooks, and any newly installed agent/command files. Those would otherwise sit unstaged or (for a project that never had them) **untracked**, so the user would see an incomplete picture in `git diff --cached`. Finish with a `git status` summary of exactly what was staged.
  - **Operates on the current working directory only.** No scanning for projects — too magical, and the list is six long. Resolve the root via the same dual-read discovery as everything else, and refuse with a clear error if cwd is not a Cairn/Ralph project.
  - **Upgrades agents and commands.** Installs the full current set even where none existed, so lyrical-pitch-reservations comes up to the current layout. Overwrite by filename; never delete or touch files not in the source set, so custom agents like its `frontend-code-analyzer.md` survive untouched.

- **Literals in test assertions.** Tests assert concrete `.cairn` / `cairn.json` strings rather than importing `BRAND` — catches both a `brand.ts` typo and a stray hardcoded `.ralph`.

- **Explicit exclusion list on every sweep task.** Exclude `tasks.completed.json`, `.ralph_iterations.log`, `.ralph_tasks_snapshot.json`, `reviews/round-*.md`, `.ralph_task_*_notes.md`, and `audit/`. Without it an agent will "fix" the archive and silently falsify completed work. These move by `git mv` only.

Personal instruction: TDD within each task — write the test, watch it fail, make it pass. Test updates fold into the source task they cover.

## Rejected Alternatives

This round:
- **Truly runtime-configurable name.** Rejected on a bootstrap trap — discovery walks up looking for the data dir, so if both the dir name and the config filename come from config, no fixed anchor remains. Plus near-zero payoff: nobody runs two differently-named installs.
- **Straight rename with no abstraction.** Rejected — identical ~1,100-reference cost on any future rename.
- **~~No migrate command~~ — REVERSED this session.** Originally rejected as "must be run in every project before the new binary works." Dual-read makes that false: migrate is optional convenience, not a prerequisite. At six projects × (data dir + config + 7 `.claude/` files + 3 hooks + `.gitignore` + 4 stateful temp files), by hand is error-prone. Now in scope.
- **Hard cutover with no compatibility surface.** Rejected — one shared symlink means the first rebuild cuts over all six projects at once.
- **Dropping the `ralph` symlink this round.** Rejected — four projects have `ralph task` frozen into their installed `.claude/agents/*.md`.
- **Renaming `.ralph_task_*_notes.md`.** Rejected — write-and-sweep scratch never read back, and 24 are committed history in karaoke-platform. Only the sweep regex changes, to match both prefixes.
- **`BRAND` constant in test assertions.** Rejected as partly tautological — a wrong `brand.ts` value would still pass.
- **Mixed test style** (literals for contracts, `BRAND` for incidentals). Rejected — per-test judgment for little gain.
- **Rename Python files but keep `/tmp/ralph-tts.sock`.** Rejected — permanent inconsistency to preserve hooks that are already stale elsewhere.
- **Defer narration entirely.** Rejected — narration is disabled in this repo's config, so this is the cheapest moment.
- **Rewriting archives during the sweep.** Rejected — falsifies history. They move unmodified.
- **Normalizing `RALPH_ANTHROPIC_API_KEY` to `ANTHROPIC_API_KEY`.** Rejected — the prefix is load-bearing for Max-plan forcing.
- **Migrating all six projects inside this round.** Rejected — karaoke-platform has 2 pending tasks and a dirty tree; migrations are follow-up work driven at the user's pace.
- **Splitting the round into batches with a stop/rebuild/restart between each.** Rejected — needs 4–5 manual stop/start cycles, and every batch boundary is a fresh opportunity to get the ordering wrong. Pinning the binary achieves the same safety with two setup commands and zero interruptions.
- **Redirecting the health check without also pinning the symlink.** Rejected — `dist/ralph` would stay frozen by default, but any stray `bun run build` (an agent debugging a compile error, a `package.json` script invoked incidentally) silently un-freezes it. The pin makes the guarantee structural rather than conventional.
- **Leaving the mid-loop rebuild gate in place.** Rejected once the hot-swap mechanic was traced: the gate was never the real boundary, since the binary was already being replaced at every iteration. A gate would have provided false reassurance.

Carried from prior sessions (still relevant):
- **Per-task review files (`reviews/task-<id>.md`).** Not adopted; remains the escape hatch if per-round files grow too long.
- **Tail `tasks.completed.json` for the last id, then +1** — rejected; IDs reset each round historically.
- **Prompt-only fix for ID reuse** — rejected in favor of the CLI counter.
- **Agent-managed `state.json`** — rejected; no atomicity guarantee.
- **CLI counter for `generate-tasks` only** — rejected; both ID-assigning paths must share it.
- **Store `nextTaskId` inside `tasks.json`** — rejected; separate `state.json` survives rewrites.
- **Audit agent writes `planning-notes.md` directly** — rejected; the planner owns formatting.
- **Configurable audit lenses** — kept fixed (security + SOLID).
- **Separate `audit` CLI command instead of a slash command** — rejected; keeps the user in the planner session.
- **Anthropic TS SDK instead of shelling out to `claude`** — shelling out gives tools/permissions/MCP for free.
- **Port narration to TypeScript** — Kokoro TTS and sounddevice are Python-specific. (Reaffirmed: narration is renamed, not rewritten.)
- **Skills instead of subagents** — subagents get fresh context with full tool access.
- **Change storage format (SQLite / per-task files / JSONL)** — CLI subcommands get ~95% of the benefit.
- **Pre-commit to git worktrees for parallel execution** — deferred to the RFC round.

## Rough Task Outline

**MANUAL: pre-round setup (do this before starting the loop).**

```
cp dist/ralph ~/.local/bin/ralph-frozen
ln -sf ~/.local/bin/ralph-frozen ~/.local/bin/ralph
# ralph.json, this round only:
#   "healthCheck": "bun build --compile src/index.ts --outfile /tmp/cairn-healthcheck"
```

Verify `ralph --version` still works and that `ls -la ~/.local/bin/ralph` points at the frozen copy. With this in place there is **no mid-loop rebuild** — tasks 1–21 run uninterrupted.

Resolved-path threading (task 2) must still precede anything that builds permission rules (task 10). **MANUAL** steps are the user's.

1. **`src/brand.ts` + dual-read discovery/config.** Brand constant; `findProjectRoot` (`utils.ts:49`) tries `.cairn/` then `.ralph/`; `loadConfig` (`config.ts:10`) tries `cairn.json` then `ralph.json` with a one-time legacy warning. Nothing else renamed. — `src/`, `test/`
2. **Thread the resolved `dataDir`.** Fix `index.ts:127` and `post-task-reviewer.ts:137` to use the resolved `dataDir` rather than reconstructing from a hardcoded/branded segment. Test that a project on legacy `.ralph/` gets an allowlist rule pointing at `.ralph/reviews/**`. Blocks task 9. — `src/`, `test/`
3. **Stateful temp files: dual-read + prefix.** `.cairn_*` for new writes; read falls back to `.ralph_*` for `.ralph_completed_ids`, `.ralph_prev_notes`, `.ralph_iterations.log`, `.ralph_tasks_snapshot.json`. Sweep regex (`run.ts:685`) matches both prefixes. — `src/`, `test/`
4. **Dual-name build and install.** `package.json` outfile → `dist/cairn`; `install.sh` symlinks both `cairn` and `ralph`. Safe to land mid-round now: the pinned binary is unaffected, and the health check no longer writes to `dist/`. — repo root
5. **Env vars → `CAIRN_*`.** `setConfigEnvVars` (`config.ts:132-143`) and all readers; three-way API-key chain in the narration server; drop dead `RALPH_FORCE_SHELL`; delete the stale `ralph_config.sh` comment. — `src/`, `lib/`, `test/`
6. **Internal identifiers.** `RalphConfig` → `CairnConfig`, `resolveRalphRoot` → `resolveCairnRoot`, `ralphRoot`, `RALPH_VERSION`, `writeRalphJson` → `writeCairnJson`. — `src/`, `test/`
7. **`src/commands/init.ts`.** Data-dir creation and messages, `.gitignore` content with both prefixes (`init.ts:9-14`), the three hook templates (`:228,252,271`), `writeCairnJson`, the "run `cairn plan`" hint. 42 refs. — `src/commands/`, `test/commands/`
8. **`src/commands/task.ts` usage strings.** ~20 agent-facing `ralph task ...` → `cairn task ...`. — `src/commands/`, `test/commands/`
9. **Agent-facing prompts.** `run.ts:141`, `agent-prompt.ts:13`, and the reviewer allowlist rule. Depends on task 2. — `src/`, `src/commands/`, `test/`
10. **Remaining `src/` sweep.** `status`, `edit`, `logs`, `narrate`, `summarize`, `plan`, `stream-filter`, `tasks-file`, `task-archiver`, `task-counter`, `task-selector`, `file-lock`, `process`, `index`. — `src/`, `test/`
11. **Python narration.** `lib/ralph_narrate*.py` → `lib/cairn_narrate*.py`, socket default → `/tmp/cairn-tts.sock`, `CAIRN_NARRATE_SOCKET`; delete stale `__pycache__`; update `src/narration.ts` paths. — `lib/`, `src/`, `test/`
12. **Agent and slash-command sources.** `agents/*.md` and `commands/*.md` at the repo root (**not** the `.claude/` copies): `planner`, `post-task-reviewer`, `summarizer`, `audit-planner`, `generate-tasks`, `review-tasks`, `codebase-audit`. — `agents/`, `commands/`
13. **`cairn migrate` — core moves.** Operates on **cwd only**; resolve the root via dual-read discovery and error clearly if cwd is not a Cairn/Ralph project. Preflight (refuse on in-progress tasks, warn on dirty tree); `git mv` data dir and config; rename the four stateful temp files; leave `.ralph_task_*_notes.md` and all archives untouched. Tolerate partial installs. **Stage, never commit.** Test via `bun run src/index.ts migrate` against a temp fixture — **not** the pinned binary. — `src/commands/`, `test/commands/`
14. **`cairn migrate` — `.claude/` refresh + staging.** Install the full agent/command set even where none existed (upgrade path for lyrical-pitch-reservations); overwrite by filename only, never delete, so custom agents survive. Regenerate hooks only if present. Rewrite `.gitignore` with both prefixes preserving custom lines (karaoke-platform added `instructions.md`). **`git add` all non-`git mv` output** — rewritten `.gitignore`, hooks, and newly installed files — so nothing lands untracked, then print a `git status` summary. Idempotent. — `src/commands/`, `test/commands/`
15. **Docs.** `README.md` (72 refs — incl. `RALPH_NARRATE_SOCKET` at `:161`, API key at `:20`), `CLAUDE.md` (21 refs — data-layout tree, agent-workflow section, forbidden-direct-edit paragraph), `docs/parallel-execution-rfc.md`. Document `cairn migrate`, the compatibility window, and the pin/unpin procedure. — repo root, `docs/`
16. **Verification sweep.** `grep -rni ralph` excluding archives and `.git/`. Every hit must be an intentional fallback or a historical-record file. Mark surviving fallbacks with a "remove once all projects migrated" comment. — repo root

### Post-round (all MANUAL, loop stopped)

17. **Unpin and rebuild — the one deliberate cutover.** Restore `healthCheck` to `bun run build` in config; run `./install.sh`; verify `cairn --version` *and* `ralph --version`. Remove `~/.local/bin/ralph-frozen`. **This is the moment all six projects cut over** — nothing before it touches them.
18. **Sync this repo's `.claude/` copies.** Copy updated `agents/` and `commands/` into `.claude/`; regenerate `.claude/hooks/*.sh` for the new socket.
19. **Migrate this repo.** Run `cairn migrate` on itself — the first real-world test, on the project you can most afford to break. Archives move unmodified.
20. **`~/.zshrc:111`.** `RALPH_ANTHROPIC_API_KEY` → `CAIRN_ANTHROPIC_API_KEY`. The fallback means forgetting this degrades quietly — easy to miss.
21. **Rename the repo folder.** `_Repos/ralph` → `_Repos/cairn`; re-run `./install.sh`. Fixes the derived commit prefix. Last, because an agent cannot rename its own working directory. **Keep the `ralph` symlink.**

### Follow-up (user-driven, outside this round)

Per project, in this order — idle ones first, karaoke-platform last:

- **karaoke-kiosk, karaoke-remote, karaoke-reservation** — `cairn migrate`, review the rename commit, delete stale `.claude/settings.local.json` path rules, fix 2 doc refs in karaoke-reservation. karaoke-remote also picks up its stale `post-task-reviewer.md` via the re-install.
- **lyrical-pitch-reservations** — active, just idle for a while. It is on the **oldest layout**: no `state.json`, no `reviews/`, no `instructions.md`, and none of the four agents or three slash commands ever installed (only a custom `frontend-code-analyzer.md`, which must survive the refresh). For this project `migrate` is effectively an *upgrade* — it gains agents and commands it never had. Best test case for the "tolerate partial installs" requirement in task 14. `state.json` lazy-seeds on first use, so no backfill needed.
- **karaoke-platform** — resolve or defer its 2 pending tasks and commit its dirty tree first. Largest migration: 57 tracked files. Has one stale permission rule (`Edit(//Users/.../.ralph/review-post.md)`) and 1 doc ref.
- **Legacy `review-post.md`** still exists in karaoke-platform and karaoke-kiosk — decide keep-as-history or delete (this repo deleted it last round).
- **Once all six are migrated:** drop the `ralph` symlink, remove every dual-read fallback, and delete the compatibility warnings.

The `planner` agent suits tasks 1, 2, and 14 (sequencing and permission-rule interactions). Tasks 7, 9, and 11 are mechanical sweeps for a generalist.

## Open Questions

1. **`.claude/settings.local.json` stale entries.** karaoke-platform has one absolute `.ralph` path; this repo has a dead `RALPH_FORCE_SHELL` rule. Should `migrate` rewrite these automatically, or stay out of a file Claude Code owns? Leaning stay out and report only — consistent with the "overwrite by filename, never delete" rule settled for agents.
2. **When can the compatibility surface actually go?** Gated on all six migrations. Task 16's markers make the removal round mechanical.

*(Resolved this session: migrate stages without committing; operates on cwd only, no project self-detection; installs the full agent/command set even where none existed. All three are recorded in Approach and tasks 13–14.)*
