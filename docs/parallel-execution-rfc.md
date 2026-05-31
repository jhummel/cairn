# RFC: Parallel Task Execution

**Status:** Draft — for discussion
**Scope:** Design only. No code or tests are introduced by this document.
**Author:** Ralph (iteration 6)

## 1. Summary

Ralph today executes tasks strictly one at a time. Each iteration of the loop in
`src/commands/run.ts` (`runRun`) picks a single task via `selectNextTask`
(`src/task-selector.ts`), spawns one `claude -p` agent, waits for it to exit,
validates tests, optionally reviews, archives, and carries notes forward to the
next iteration. The loop is fully sequential — `await deps.spawnClaude(...)` is a
hard barrier between tasks.

When a plan contains several tasks that are mutually independent (no dependency
edges between them, and no overlapping files), running them serially leaves the
machine idle most of the time: one agent works while the others wait their turn.

This RFC proposes an **opt-in** parallel mode (`--parallel N`) that executes up
to `N` dependency-free, non-conflicting tasks concurrently as a "wave," while
keeping today's serial behavior as the untouched default. It deliberately leaves
the **isolation model** (§3) as the central open decision rather than
pre-committing to one approach.

## 2. Current serial behavior (the baseline we must not break)

The relevant facts about today's implementation, with file references, because
every design choice below is constrained by them:

- **Single selection.** `selectNextTask(tasks, completedIds)`
  (`src/task-selector.ts:44`) returns exactly one `Task | null`: in-progress
  first, otherwise the highest-priority pending task whose dependencies are all
  satisfied. It has no notion of "the set of currently-running tasks."
- **One agent, shared working tree.** `spawnClaude`
  (`src/commands/run.ts:184`) runs `claude` with `cwd` = the task's directory
  *inside the one repo checkout*. There is no isolation between agents because
  there is only ever one agent.
- **Focused commits in the shared tree.** The per-task system prompt
  (`buildSystemPrompt`, `src/commands/run.ts:129`) instructs the agent to
  `git commit` with prefix `[<commitPrefix>] Task #<id>: <title>`. All commits
  land on the same branch in the same tree.
- **Unlocked task-file mutation.** `mutateTasksFile`
  (`src/tasks-file.ts:174`) does read → mutate → atomic temp-write → rename,
  plus a snapshot. It is atomic *per write* but has **no cross-process lock**:
  concurrent `ralph task` subcommands can interleave read-modify-write and lose
  updates (last writer wins). This is safe today only because exactly one agent
  ever mutates the file at a time.
- **Per-iteration snapshot.** Before spawning, the loop snapshots a known-good
  `tasks.json` (`src/commands/run.ts:454–463`) for corruption recovery.
- **Single narration socket.** `src/narration.ts` talks to one Unix socket
  (`/tmp/ralph-tts.sock`); `processStream` invokes `streamOpts.narrate` for the
  one running agent (`src/commands/run.ts:539–543`). Audio is inherently a
  single shared channel — you cannot play two narrations at once intelligibly.
- **Single prevNotes predecessor.** `prevNotes` is one string carried from the
  archive result of the immediately-preceding task
  (`src/commands/run.ts:624–625`) into `buildIterationPrompt`
  (`src/task-selector.ts:67`).
- **Sequential validate → review → archive.** After the agent exits, the loop
  runs `validateTaskTests`, then `runPostTaskReview`, then
  `archiveCompletedTasks`, in order, for that one task
  (`src/commands/run.ts:580–625`).

Every section below is a delta against this baseline.

## 3. Isolation model — THE central open decision (UNRESOLVED)

This is the load-bearing choice of the entire feature and is **intentionally
left open** for review. Two agents writing files in one checkout at the same
time can clobber each other's edits and produce interleaved, unattributable git
history. There are two credible strategies, each with real trade-offs. We
present both and recommend a path to *decide*, not a decision.

### Option A — Git worktree per task

Give each concurrently-running task its own `git worktree` (a separate working
directory backed by the same `.git`), on its own ephemeral branch. Agents never
share a filesystem checkout; merges happen after each agent exits.

**Pros**

- True isolation: two agents editing the *same file* cannot corrupt each other.
- The set of schedulable tasks is maximal — file overlap no longer blocks
  concurrency, so a wave can run any `N` dependency-free tasks.
- Each agent's commits are cleanly attributable on its own branch.

**Cons**

- Merge complexity moves to Ralph: after a wave, branches must be merged back
  (fast-forward where possible, otherwise a real merge that can *conflict*).
  Conflict resolution in autonomous mode is a hard, possibly agent-requiring
  problem with no obvious safe default.
- Setup/teardown cost per task (worktree add/remove, branch create/delete),
  and disk for `N` checkouts.
- Build artifacts / `node_modules` / caches are not shared across worktrees
  unless explicitly linked — health checks and tests may need per-worktree
  install.
- `taskDir` semantics change: `cwd` becomes `<worktree>/<taskDir>` rather than
  `<projectRoot>/<taskDir>`.

### Option B — Directory-disjoint scheduling (shared tree, no overlap)

Keep the single shared checkout. The scheduler only co-runs tasks whose
file/directory footprints are provably disjoint, so no two live agents can touch
the same path. No worktrees, no merges.

**Pros**

- Minimal change to the execution model: agents still run in the one tree and
  commit as they do today (`src/commands/run.ts:129`). No merge step.
- No extra disk, no per-task install, no branch bookkeeping.

**Cons**

- Concurrency is throttled by *footprint conflicts*, not just dependencies — a
  plan where everything touches `src/` shared files serializes anyway.
- Footprint must be known up front. Tasks declare `files` / `directory`, but
  agents routinely edit files outside their declared set ("you may work wherever
  needed"). Disjointness is therefore **advisory, not enforced** — a real risk.
- Concurrent commits to one branch from multiple agents interleave; even
  disjoint file sets produce a tangled, hard-to-bisect history and racy
  `git add`/`git commit` invocations.

### How to decide

Recommended decision procedure (not a verdict):

1. **Start with Option B behind the flag** as the lower-risk first cut, *if and
   only if* we tighten footprint declaration (treat undeclared writes as a
   scheduling violation and fall back to serial for that task).
2. **Treat Option A as the target end-state** for high-concurrency use, gated on
   solving autonomous merge-conflict handling (likely: fast-forward-only merges,
   and on conflict, re-queue the loser as serial).
3. Decide based on the **observed conflict rate** of real plans: if footprint
   declarations prove unreliable in practice, the safety argument pushes to A.

The remaining sections are written to be **isolation-agnostic** where possible,
and call out explicitly where they depend on which option wins.

## 4. Scheduling — a plural ready-set selector

Today's `selectNextTask` returns one task. Parallel mode needs a *set*. The
proposal is a new selector (conceptually `selectReadyTasks(tasks, completedIds,
{ cap, running })`) that:

1. Reuses today's readiness rule unchanged: a pending task is ready iff every id
   in `dependencies` is in the completed set (active `complete` ∪ archived ∪
   `completedIds`) — identical to `src/task-selector.ts:56–62`.
2. Returns the ready tasks sorted by `priority` ascending (same ordering as
   today), **capped at `N`** (the `--parallel` value), minus any already running.
3. Applies **conflict filtering** so the returned set is internally safe to run
   together:
   - **Dependency-internal conflicts:** never co-schedule a task with one of its
     own (transitive) dependencies — already implied by readiness, but must also
     exclude pairs where one ready task depends on another ready task.
   - **Footprint conflicts (Option B only):** drop any task whose declared
     `files`/`directory` overlaps a higher-priority task already chosen for this
     wave. Skipped tasks fall through to a later wave. Under Option A this filter
     is a no-op (worktrees make footprints irrelevant).
4. Preserves the **in-progress-first** invariant: any task left `in-progress`
   from a crashed prior run is picked up before fresh pending work, exactly as
   `src/task-selector.ts:46–48` does today.

Edge cases:

- If the ready set has fewer than `N` members, run what's available; do not
  block waiting to "fill" a wave.
- `--parallel 1` must be behaviorally identical to serial mode (degenerate
  wave of one). This is the key compatibility guarantee.
- If the only ready tasks all conflict with each other (Option B), the wave
  degrades to a single task — never deadlock.

### Wave vs. rolling concurrency

Two execution shapes are possible:

- **Wave (barrier):** launch up to `N`, wait for *all* to finish, then
  post-process the batch and select the next wave. Simpler; matches the existing
  loop structure (one barrier per iteration). Wastes wall-clock when task
  durations are uneven (fast agents idle waiting for the slow one).
- **Rolling:** maintain a pool of `N` slots; as each agent finishes, immediately
  post-process it and pull the next ready task into the freed slot. Better
  utilization, but post-processing (validate/review/archive) now interleaves
  with running agents, complicating the snapshot and task-file timing (§6).

**Recommendation:** ship **wave** first (smaller delta to `runRun`'s
single-barrier loop), with rolling as a follow-up once the wave version is
stable. The rest of this RFC assumes the wave model unless noted.

## 5. Output rendering for N concurrent agents

Today `spawnClaude` pipes one agent's filtered stream straight to
`process.stdout` (`src/commands/run.ts:230`). With `N` agents this interleaves
into noise. Three options, in increasing order of preference:

1. **Task-id line prefixes.** Each rendered line is prefixed with `[#<id>]`
   (and ideally a stable per-task color). Lowest effort — only the stream
   writer changes, output stays a single scrolling log. Lines from different
   agents still intermix but are attributable. Good default for piped/CI output.
2. **Per-task log files.** Each agent's stream is written to
   `.ralph/logs/iter-<n>-task-<id>.log`; the console shows a compact status
   line per task. Best for post-hoc debugging; loses the live feel.
3. **Sectioned/TUI view.** A multi-pane live view, one region per active task.
   Best UX, highest cost, and fragile across terminals / non-TTY contexts.

**Recommendation:** implement **(1) prefixes** as the baseline (works
everywhere, including non-TTY), **always also write (2) per-task log files** for
debuggability, and treat **(3)** as an optional enhancement gated on `isTTY`.
The serial path is unchanged — no prefix needed when there is one agent.

## 6. Narration & notifications

Audio narration is a *single shared channel* (`/tmp/ralph-tts.sock`,
`src/narration.ts`) and ntfy push is rate-sensitive. Streaming per-token
narration for `N` agents at once is incoherent. Therefore:

### Parallel mode

- **Drop per-agent streaming narration.** Do **not** wire
  `streamOpts.narrate` for individual agents (the hook set at
  `src/commands/run.ts:539–543`). The continuous narration that makes sense for
  one agent becomes babble for many.
- **Narrate lifecycle milestones only**, via a **serialized queue**: emit a
  short utterance on task **started**, **completed**, and **failed**
  (e.g. "Task 12 started", "Task 12 complete", "Task 9 failed tests"). Because
  the socket is single-consumer, milestone events from concurrent agents are
  pushed onto an in-process queue and drained one at a time so utterances never
  overlap. The narration health-check / restart logic
  (`src/commands/run.ts:428–447`) is unchanged — there is still one server.
- **Batch ntfy into wave summaries.** Instead of per-event pushes, send one
  notification per wave: "Wave complete: 3/4 tasks done, task 9 failed." This
  respects ntfy rate limits and keeps the phone usable. The final-summary ntfy
  (`src/commands/run.ts:654–663`) stays as-is.

### Serial mode (`--parallel` unset or `1`)

- **Unchanged.** Full per-token streaming narration and per-event behavior
  exactly as today (`src/commands/run.ts:533–550`). This is a hard
  compatibility requirement: no observable behavior change for existing users.

## 7. Knock-on effects

Each of these is a place where the serial assumptions in `runRun` break under
concurrency.

### 7.1 `prevNotes` carry-forward

Today exactly one predecessor's notes flow forward
(`src/commands/run.ts:624–625` → `buildIterationPrompt`,
`src/task-selector.ts:89–92`). In a wave there is **no single predecessor** —
`N` tasks complete together. Options:

- **Aggregate:** concatenate the completed tasks' notes from the just-finished
  wave into the `prevNotes` block for the *next* wave, labeled by task id.
- **Per-lineage (preferred for Option A/dependencies):** a task should receive
  the notes of the specific predecessor(s) it *depends on*, not arbitrary wave
  siblings. Since siblings in a wave are dependency-disjoint by construction,
  sibling notes are usually irrelevant anyway. The cleanest model: carry each
  task's dependency-completion notes, resolved from the archive, rather than a
  global "previous iteration" string.

**Recommendation:** in parallel mode, pass each task the aggregated notes of its
satisfied dependencies (resolved at selection time), and drop the implicit
"immediately previous task" coupling, which has no meaning across a wave.

### 7.2 Per-iteration `tasks.json` snapshot

Today the snapshot is taken once per iteration before the single agent runs
(`src/commands/run.ts:454–463`). In wave mode, take the snapshot **once before
launching the wave** (a known-good baseline for the whole wave). In rolling
mode, snapshotting becomes racy (agents mutate the file while others run) — take
it before launching the first agent and again only at wave boundaries, never
mid-flight. The snapshot remains best-effort and non-fatal.

### 7.3 Concurrent task-file mutation (the real hazard)

This is the sharpest knock-on. `mutateTasksFile` (`src/tasks-file.ts:174`) is
atomic per write but **not locked across processes**. With `N` agents each
running `ralph task start/complete/note` concurrently, two read-modify-write
cycles can interleave and silently lose an update.

This *must* be addressed before any parallel mode ships. Options:

- **File lock** (e.g. an advisory lockfile / `flock`-style guard) around the
  read→mutate→write→snapshot critical section in `mutateTasksFile`, so the `N`
  agents' subcommands serialize their writes.
- **Per-task status files** that the loop reconciles into `tasks.json`,
  avoiding shared-file contention entirely (larger change).

**Recommendation:** add cross-process locking to `mutateTasksFile` as a
prerequisite. It is also strictly safe for serial mode (uncontended lock = ~no
cost), so it can land independently and ahead of the rest of this feature.

### 7.4 Test-validation timing

`validateTaskTests` runs after the agent exits (`src/commands/run.ts:580–585`).
In wave mode, run validation **per task as part of post-wave processing**, after
all wave agents have exited and (Option A) their branches have merged — because
under a shared tree, one task's tests could observe another task's
half-committed state if validated mid-wave. Under Option A, validate each task
*in its own worktree before merge* to attribute failures correctly. A
validation failure reverts that one task to `in-progress`
(today's behavior) without affecting its wave siblings.

### 7.5 Post-task review under parallelism

`runPostTaskReview` (`src/commands/run.ts:587–613`) diffs against `beforeSha`
captured before the agent ran (`src/commands/run.ts:553`). With concurrent
agents committing to one branch (Option B), a single `beforeSha`→`afterSha`
diff would conflate multiple tasks' changes. Mitigations:

- **Option A:** review each task's branch diff (its merge-base → branch tip) —
  clean per-task attribution, the natural fit.
- **Option B:** capture a per-task `beforeSha` and restrict the review diff to
  that task's declared footprint, accepting that overlapping commits may blur
  attribution. Reviews run sequentially after the wave to avoid `N` heavy review
  agents competing for resources.

## 8. Rollout

- **Opt-in flag:** `ralph run --parallel N`. Default (flag absent) = `1` =
  today's exact serial path. The serial code path is preserved verbatim, not
  reimplemented in terms of the parallel one, until parallel mode is proven.
- **Sequencing of work** (each independently shippable):
  1. Cross-process lock in `mutateTasksFile` (§7.3) — safe and useful on its
     own, lands first.
  2. Plural `selectReadyTasks` selector (§4), unit-tested against the same
     fixtures as `selectNextTask`, with `N=1` proven identical to serial.
  3. Wave execution in `runRun` with prefixed output (§5) and milestone
     narration (§6), behind `--parallel`.
  4. Isolation: ship **Option B** (directory-disjoint, §3) first *or* **Option
     A** (worktrees) — this is the open decision §3 must resolve before step 3
     can be finalized.
  5. Rolling concurrency (§4) and sectioned TUI (§5) as later enhancements.
- **Kill switch:** `--parallel 1` (or omitting the flag) always returns to
  serial. No data-format changes to `tasks.json` are required by this feature,
  so downgrading is safe.

## 9. Open questions (summary)

1. **Isolation: worktrees (A) vs. directory-disjoint (B)?** — §3, the central
   unresolved decision. Everything downstream (merge handling, review diffing,
   validation, scheduling cap effectiveness) depends on it.
2. Wave barrier vs. rolling pool for v1? (RFC recommends wave.) — §4
3. How strictly do we enforce declared task footprints under Option B, given
   agents are told they "may work wherever needed"? — §3, §4
4. Autonomous merge-conflict policy under Option A (re-queue serial? agent-driven
   resolution?). — §3, §7.5
5. Lock implementation for `mutateTasksFile` (advisory lockfile vs. OS flock vs.
   per-task status files). — §7.3
