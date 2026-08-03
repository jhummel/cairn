/**
 * Single source of truth for the project's identity.
 *
 * BRAND is NOT user-configurable — it is a compile-time constant, not config.
 *
 * STANDING RULE: BRAND.dataDir / BRAND.configFile are for CREATING paths, never
 * for RESOLVING them. Any path that points at an existing project's data must
 * come from the value discovery actually found (`findDataDir()` in src/utils.ts,
 * `findConfigFile()` in src/config.ts) — otherwise a project still on the legacy
 * layout gets paths pointing at a directory that does not exist.
 */
export const BRAND = Object.freeze({
  name: 'cairn',
  displayName: 'Cairn',
  dataDir: '.cairn',
  configFile: 'cairn.json',
  envPrefix: 'CAIRN_',
  tempPrefix: '.cairn_',
  socket: '/tmp/cairn-tts.sock',
});

/**
 * The pre-rename identity. Still read (never written) so that projects which
 * have not migrated keep working. Other projects on this machine still use the
 * legacy layout, so these fallbacks are load-bearing.
 */
export const LEGACY = Object.freeze({
  name: 'ralph',
  displayName: 'Ralph',
  dataDir: '.ralph',
  configFile: 'ralph.json',
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
