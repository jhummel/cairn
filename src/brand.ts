/**
 * Single source of truth for the project's identity.
 *
 * BRAND is NOT user-configurable — it is a compile-time constant, not config.
 *
 * STANDING RULE: BRAND.dataDir / BRAND.configFile / BRAND.socket / BRAND.pidFile
 * are for CREATING paths, never for RESOLVING them. Any path that points at
 * something that already exists must come from the value discovery actually
 * found (`findDataDir()` in src/utils.ts, `findConfigFile()` in src/config.ts,
 * `findNarrationSocketPath()` / `findNarrationPidFile()` in src/narration.ts) —
 * otherwise a project still on the legacy layout gets paths pointing at
 * something that does not exist.
 */
export const BRAND = Object.freeze({
  name: 'cairn',
  displayName: 'Cairn',
  dataDir: '.cairn',
  configFile: 'cairn.json',
  envPrefix: 'CAIRN_',
  tempPrefix: '.cairn_',
  /** Unix socket the narration server binds and the .claude/hooks/*.sh clients dial. */
  socket: '/tmp/cairn-tts.sock',
  /** Where `cairn narrate on` records the narration server's PID. */
  pidFile: '/tmp/cairn-tts.pid',
});

/**
 * The pre-rename identity. Still read (never written) so that projects which
 * have not migrated keep working. Other projects on this machine still use the
 * legacy layout, so these fallbacks are load-bearing.
 *
 * remove once all projects migrated — deleting this object is the entry point
 * for the removal round; every compatibility fallback in the codebase either
 * reads from it or carries the same marker.
 */
export const LEGACY = Object.freeze({
  name: 'ralph',
  displayName: 'Ralph',
  dataDir: '.ralph',
  configFile: 'ralph.json',
  tempPrefix: '.ralph_',
  socket: '/tmp/ralph-tts.sock',
  pidFile: '/tmp/ralph-tts.pid',
});

const warnedKeys = new Set<string>();

/**
 * Emit a legacy-layout warning at most once per process, per key.
 *
 * Discovery helpers run on nearly every call path, so an unguarded warning
 * would print dozens of times per command. Returns true when the message was
 * actually emitted. Warnings go to stderr to keep stdout machine-readable.
 */
export function warnLegacyOnce(key: string, message: string): boolean {
  if (warnedKeys.has(key)) return false;
  warnedKeys.add(key);
  console.error(`[${BRAND.name}] ${message}`);
  return true;
}

/** Re-arm every one-time legacy warning. Exists for tests. */
export function resetLegacyWarnings(): void {
  warnedKeys.clear();
}
