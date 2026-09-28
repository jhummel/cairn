/**
 * Single source of truth for the project's identity.
 *
 * BRAND is NOT user-configurable — it is a compile-time constant, not config.
 *
 * STANDING RULE: BRAND.dataDir / BRAND.configFile are for CREATING paths,
 * never for RESOLVING them. Any path that points at something that already
 * exists must come from the value discovery actually found (`findDataDir()` in
 * src/utils.ts, `findConfigFile()` in src/config.ts) — otherwise a path is
 * built from what the name *should* be rather than from what is actually on
 * disk, and points at something that does not exist.
 */
export const BRAND = Object.freeze({
  name: 'cairn',
  displayName: 'Cairn',
  dataDir: '.cairn',
  configFile: 'cairn.json',
  envPrefix: 'CAIRN_',
  tempPrefix: '.cairn_',
});

/**
 * Prefix for the per-task notes scratch files (`<prefix>task_<id>_notes.md`)
 * that `buildSystemPrompt` hands each agent.
 *
 * This is a PERMANENT exception, NOT a compatibility fallback: it keeps the
 * pre-rename spelling forever and nothing resolves against BRAND.tempPrefix as
 * an alternative. The files are write-and-sweep scratch that is never read
 * back, so the name carries no meaning beyond "agent and sweep agree" — and
 * renaming it would churn committed .gitignore history in every project for
 * zero behavioural gain.
 *
 * Consumers: `buildSystemPrompt` in src/commands/run.ts, `NOTES_TEMPFILE_RE` in
 * src/temp-sweep.ts, and the .gitignore block in src/commands/init.ts.
 */
export const NOTES_TEMP_PREFIX = '.ralph_';
