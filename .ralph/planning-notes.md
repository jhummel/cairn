## Context

Ralph is being used to work on itself for the first time. The codebase has accumulated cruft from its origins as a monorepo orchestration tool — specifically a `scope` field (internal/integration) on tasks and "service" terminology throughout. There's also an avatar feature (animated tkinter companion window during narration) that was a fun experiment but adds bloat.

No previous planning sessions exist.

## Goals

1. **Remove the scope concept entirely.** The `scope` field (`internal`/`integration`) on tasks controlled whether agents were told to stay within their directory or allowed to touch multiple directories. This distinction isn't useful — agents should just work wherever the task needs. Remove all functional code, schema definitions, prompt text, and documentation related to scope. Also clean up leftover "service" terminology (e.g., "service-level CLAUDE.md", "service boundaries") with generic language like "module" or "directory".

2. **Remove the avatar feature entirely.** Delete the tkinter-based animated companion window (`ralph_avatar.py`), its sprite assets (`assets/`), and all integration points in the narration server, CLI, config, and documentation.

## Approach

Both are surgical removal tasks — no new functionality, no behavioral changes beyond removing the scope/avatar concepts. Work file-by-file, removing code and updating surrounding context so things still read naturally.

For scope removal: the key behavioral change is in `build_system_prompt()` — instead of branching on internal/integration, just emit a single set of directory instructions. The task schema drops the `scope` field. Planning prompts drop scope guidance. Docs drop scope references.

For avatar removal: delete `lib/ralph_avatar.py` and `assets/` entirely. Strip avatar imports, flags, and state management from `ralph_narrate_server.py`. Remove avatar config from `ralph_config.sh` and `bin/ralph`. Update docs.

## Rejected Alternatives

- **Keep scope but simplify:** Considered keeping scope as a soft hint rather than removing it. Rejected because the user doesn't find the directory-restriction behavior useful at all — agents should be free to work wherever needed.
- **Keep avatar code but disable by default:** Rejected because the user wants to reduce repo bloat, not just hide the feature.

## Rough Task Outline

- Remove `scope` field from task schema and all scope-branching logic in `build_system_prompt()` (`lib/ralph_execute.sh`, `lib/tasks.schema.json`)
- Remove scope references from planning prompts and task generation guidance (`lib/ralph_plan.sh`)
- Clean up "service" terminology across execution and summarization scripts (`lib/ralph_execute.sh`, `lib/ralph_summarize.sh`)
- Delete `lib/ralph_avatar.py` and `assets/` directory (`lib/`, `assets/`)
- Strip avatar integration from narration server — remove `--avatar` flag, avatar state transitions, main-thread logic (`lib/ralph_narrate_server.py`)
- Remove avatar config from CLI and config loader (`bin/ralph`, `lib/ralph_config.sh`)
- Update README.md and CLAUDE.md to remove scope and avatar documentation (project root)

## Open Questions

None.
