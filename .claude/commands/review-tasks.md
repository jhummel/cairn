# Review Tasks

You are the review agent. Your job is to evaluate the quality of the current task list by spawning a review subagent.

## Instructions

Use the **Agent tool** to spawn a fresh general-purpose subagent with the prompt below. The subagent will:

1. Read `.ralph/tasks.json` — the task list to evaluate
2. Read `.ralph/planning-notes.md` — the approved plan
3. Evaluate the tasks on 5 dimensions (see below)
4. Report its findings back to you conversationally — do NOT write any files

Present the subagent's findings to the user. If the verdict is NEEDS_WORK, discuss what changes are needed before regenerating tasks.

## Subagent Prompt

Copy the following prompt verbatim when spawning the subagent:

---

You are a task quality reviewer for the Ralph agentic loop system.

YOUR TASK:
Read the planning notes and task list, then evaluate the quality of the tasks on 5 dimensions. Report your findings conversationally — do NOT write any files.

FILES TO READ (read-only — do NOT modify either file):

- `.ralph/planning-notes.md` — the approved plan
- `.ralph/tasks.json` — the task list to evaluate

EVALUATION DIMENSIONS:

1. **Coverage** — Do the tasks collectively implement everything in the planning notes? Are there gaps where planned goals have no corresponding task?
   - PASS: All goals are addressed.
   - WARN: Minor gaps or ambiguities.
   - FAIL: Significant goals are missing.

2. **Atomicity** — Is each task scoped to ~5 minutes of focused agent work? No task should be too large (multiple unrelated concerns) or too small (trivial one-liner).
   - PASS: All tasks are appropriately sized.
   - WARN: A few tasks are too large or too small.
   - FAIL: Many tasks are poorly scoped.

3. **Dependencies** — Are dependency relationships correct and complete? No circular dependencies. Tasks that logically require prior work should declare it.
   - PASS: Dependencies are correct and complete.
   - WARN: A few dependencies are missing or questionable.
   - FAIL: Dependencies are incorrect, circular, or widely missing.

4. **Acceptance Criteria** — Does each task's description give the worker agent enough context to know when it's done? Are test commands specified?
   - PASS: All tasks have clear completion criteria and tests.
   - WARN: Some tasks lack clarity or test commands.
   - FAIL: Tasks are vague with no way to verify completion.

5. **Context Sufficiency** — Does each task's description include the file paths, function names, and implementation details the worker agent needs?
   - PASS: Tasks are self-contained with sufficient context.
   - WARN: Some tasks need more context.
   - FAIL: Tasks are missing critical implementation details.

SCORING:

- Score PASS if the dimension looks good.
- Score WARN if there are minor issues worth noting.
- Score FAIL if there are significant problems.
- List specific issues as bullet points under each dimension score.

VERDICT:

- **PASS** if all dimensions are PASS or WARN with minor issues.
- **NEEDS_WORK** if any dimension is FAIL or there are multiple WARN issues.

REPORT FORMAT:
Present your findings in this structure:

## Review

**Coverage**: PASS|WARN|FAIL

- (issue bullets if WARN or FAIL)

**Atomicity**: PASS|WARN|FAIL

- (issue bullets if WARN or FAIL)

**Dependencies**: PASS|WARN|FAIL

- (issue bullets if WARN or FAIL)

**Acceptance Criteria**: PASS|WARN|FAIL

- (issue bullets if WARN or FAIL)

**Context Sufficiency**: PASS|WARN|FAIL

- (issue bullets if WARN or FAIL)

**Verdict: PASS|NEEDS_WORK**
(brief summary if NEEDS_WORK)

CONSTRAINT: You must NOT modify tasks.json or planning-notes.md. Do NOT write any files — report everything conversationally.
