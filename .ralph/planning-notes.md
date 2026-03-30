## Context

Ralph's TypeScript rewrite is complete — all commands (status, edit, logs, init, summarize, plan, run, narrate) are ported with 601 tests passing. The shell scripts in `lib/` and `bin/ralph` are dead code for command dispatch. The compiled Bun binary at `dist/ralph` works end-to-end. But the symlink at `~/.local/bin/ralph` still points to the old `bin/ralph` shell script, and all the shell infrastructure remains in the repo.

Two Python scripts are still needed: `lib/ralph_narrate.py` (one-shot TTS) and `lib/ralph_narrate_server.py` (TTS daemon with Kokoro + Haiku). These are referenced by `src/commands/narrate.ts` and `src/commands/run.ts`.

## Goals

Clean cut from shell to TypeScript:
1. Swap the symlink to point to the compiled Bun binary
2. Delete all obsolete shell scripts and the old shell entry point
3. Remove the shell fallback mechanism from TS code
4. Fix a narration server path bug found during audit
5. Update docs to reflect the new TS-only architecture

## Approach

### Delete obsolete files

Remove everything that's been fully ported:
- `bin/ralph` — old shell entry point
- `lib/ralph_common.sh` — shared shell utilities
- `lib/ralph_config.sh` — config loading (ported to `src/config.ts`)
- `lib/ralph_init.sh` — init command (ported to `src/commands/init.ts`)
- `lib/ralph_plan.sh` — plan command (ported to `src/commands/plan.ts`)
- `lib/ralph_loop.sh` — loop driver (ported to `src/commands/run.ts`)
- `lib/ralph_execute.sh` — execution engine (decomposed into `src/task-selector.ts`, `src/health-check.ts`, `src/test-validator.ts`, `src/task-archiver.ts`, `src/process.ts`, `src/commands/run.ts`)
- `lib/ralph_summarize.sh` — summarize command (ported to `src/commands/summarize.ts`)
- `lib/ralph_stream_filter.py` — stream filter (ported to `src/stream-filter.ts`)
- `lib/tasks.schema.json` — already copied to `src/tasks-schema.json`
- `lib/__pycache__/` — Python bytecode cache

Keep in `lib/`:
- `ralph_narrate.py` — one-shot TTS (Python-only Kokoro dependency)
- `ralph_narrate_server.py` — TTS daemon (Python-only Kokoro + sounddevice)

### Remove fallback mechanism

Delete `src/commands/fallback.ts` and `test/commands/fallback.test.ts` entirely. Remove all references:
- `index.ts`: remove `shellFallback`/`forceShellFallback` imports and re-exports, remove `RALPH_FORCE_SHELL` check, remove `SHELL_FALLBACK_COMMANDS` array and its Commander registration loop
- `test/index.test.ts`: remove RALPH_FORCE_SHELL tests, update command registration expectations

### Fix `resolveRalphRoot()` marker

`src/utils.ts` currently uses `lib/ralph_common.sh` as the marker file to detect the ralph repo root. Change to `package.json` — it's always present and unique to the ralph repo root. Update `test/utils.test.ts` accordingly.

### Fix narration server path bug in `run.ts`

`src/commands/run.ts` lines 390 and 429 use `path.join(projectRoot, 'lib', 'ralph_narrate_server.py')` — this looks in the *target* project, not the ralph repo. Should use the ralph repo root (available via `resolveRalphRoot()` or `RALPH_LIB_DIR` env var). `narrate.ts` already does this correctly via `RALPH_LIB_DIR`.

### Update `install.sh`

Change from symlinking `bin/ralph` to building and symlinking `dist/ralph`:
1. Run `bun run build` to compile the binary
2. Symlink `$PREFIX/bin/ralph` → `$RALPH_ROOT/dist/ralph`
3. Check that `bun` is available, error if not

### Clean up `RALPH_LIB_DIR` usage

`RALPH_LIB_DIR` is still needed — narration scripts live in `lib/`. Keep it set in `setupProjectContext()`. But remove the comment about "shell fallback compatibility" since that's no longer the reason.

### Update documentation

Update `CLAUDE.md` and `README.md` to reflect:
- TS is the primary implementation, no shell scripts for command dispatch
- `src/index.ts` is the entry point, compiled to `dist/ralph`
- `lib/` only contains Python narration scripts
- Remove all references to `bin/ralph` as entry point
- Update file structure sections
- Remove mentions of shell fallback, `RALPH_FORCE_SHELL`

## Rejected Alternatives

- **Full rewrite in one phase:** Considered porting everything at once. Rejected — incremental approach with shell fallback means nothing breaks and we can validate each phase independently.
- **Use Anthropic TS SDK instead of shelling out to claude:** Rejected for now. Shelling out to `claude -p` gives us Claude Code's full tool suite, permissions model, and MCP support for free. Can revisit later.
- **Port narration to TypeScript:** Rejected for now. Kokoro TTS and sounddevice are Python-specific audio libraries. Keep narration as a Python subprocess spawned from TS (same as bash does today).
- **Hand-roll CLI arg parsing:** Rejected in favor of Commander. Ralph's CLI is simple but Commander is lightweight, well-known, and the maintainer is familiar with TS ecosystem tooling.
- **Modify shell scripts during rewrite:** Rejected. Shell scripts are frozen as the immutable safety net. All behavior changes go in TS only.
- **Use inquirer/prompts library for init:** Considered third-party prompt libraries. Node's built-in `readline/promises` is sufficient for simple line prompts with defaults and avoids adding a dependency.
- **Async spawn for interactive claude sessions:** Considered using async `spawn()` with event listeners for interactive plan sessions. Rejected — `spawnSync` with `stdio: 'inherit'` is simpler, matches what the shell does, and there's nothing to do while the session runs. (Note: the `run` command uses async spawn because it pipes stdout through the stream filter — this is different from interactive sessions in `plan`.)
- **Keep `RALPH_FORCE_SHELL` as safety net:** Considered keeping the shell fallback mechanism during the transition. Rejected — all commands are ported with 601 tests, the compiled binary works end-to-end, and keeping dead shell scripts creates confusion about what's authoritative.
- **Move Python narration scripts out of `lib/`:** Considered moving to a `python/` or `scripts/` directory. Could do this later, but for now `lib/` is fine — it's where `RALPH_LIB_DIR` already points and the narration code references it.

## Rough Task Outline

1. Delete obsolete shell scripts and bin/ralph — `rm bin/ralph lib/ralph_common.sh lib/ralph_config.sh lib/ralph_init.sh lib/ralph_plan.sh lib/ralph_loop.sh lib/ralph_execute.sh lib/ralph_summarize.sh lib/ralph_stream_filter.py lib/tasks.schema.json`, rm `lib/__pycache__/` — `/`
2. Fix `resolveRalphRoot()` marker — change from `lib/ralph_common.sh` to `package.json`, update tests — `src/utils.ts`, `test/utils.test.ts`
3. Remove fallback mechanism — delete `src/commands/fallback.ts` and `test/commands/fallback.test.ts`, remove all imports/references in `src/index.ts` and `test/index.test.ts` — `src/`, `test/`
4. Fix narration server path bug in run.ts — use `RALPH_LIB_DIR` or `resolveRalphRoot()` instead of `projectRoot` for narration script paths — `src/commands/run.ts`, `test/commands/run.test.ts`
5. Update `install.sh` — build with `bun run build`, symlink `dist/ralph` instead of `bin/ralph`, verify `bun` is on PATH — `/`
6. Clean up `index.ts` — remove `RALPH_FORCE_SHELL` check, remove `SHELL_FALLBACK_COMMANDS`, remove stale comments, clean up dead imports — `src/index.ts`, `test/index.test.ts`
7. Update `CLAUDE.md` — rewrite architecture section for TS-only world, update execution flow, file structure, conventions — `/`
8. Update `README.md` — update file structure, remove shell references, update installation section to mention bun build, remove `RALPH_FORCE_SHELL` mentions — `/`
9. Full test suite pass + build verification — `bun test`, `bun run build`, smoke test `dist/ralph` — `/`

## Open Questions

None.
