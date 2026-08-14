import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Merge Cairn's permission rules into a project's `.claude/settings.local.json`.
 *
 * This file is not Cairn's to own: a user may have accumulated rules in it
 * through ordinary `claude` usage long before Cairn ever ran. Every operation
 * here is therefore strictly additive — unknown keys round-trip untouched, the
 * user's own spelling of a rule is never rewritten, and a file we cannot parse
 * is left exactly as found rather than replaced with something we can.
 */

export class ClaudeSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeSettingsError';
  }
}

export interface PermissionRules {
  allow?: string[];
  deny?: string[];
}

export interface MergeResult {
  /** True when this call created the settings file from scratch. */
  created: boolean;
  /** Rules actually appended to `permissions.allow`, in supplied order. */
  addedAllow: string[];
  /** Rules actually appended to `permissions.deny`, in supplied order. */
  addedDeny: string[];
  /** Absolute path of the settings file this call targeted. */
  settingsPath: string;
}

export function claudeSettingsPath(projectRoot: string): string {
  return path.join(projectRoot, '.claude', 'settings.local.json');
}

/**
 * Reduce a rule to a comparison key. Claude Code treats `Bash(cmd:*)` as sugar
 * for `Bash(cmd *)`, so both spellings must collapse to one key — otherwise a
 * user who wrote the spaced form accumulates an equivalent duplicate on every
 * run. The sugar is Bash-specific, so it is deliberately not applied to other
 * tools: collapsing `Read(x:*)` into `Read(x *)` could merge two genuinely
 * different rules.
 *
 * Only the trailing suffix is normalized. Everything before it is compared
 * verbatim, which keeps `Bash(git:*)` and `Bash(git diff:*)` distinct.
 *
 * FOR COMPARISON ONLY — the return value is never written to disk.
 */
export function canonicalizeRule(rule: string): string {
  const trimmed = rule.trim();
  const match = /^Bash\((.*)\)$/s.exec(trimmed);
  if (!match) return trimmed;

  const arg = match[1];
  if (!arg.endsWith(':*')) return trimmed;
  return `Bash(${arg.slice(0, -2)} *)`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read and validate the existing settings file. Returns null when absent.
 * Anything we cannot confidently interpret throws — the caller must never
 * fall back to "write a fresh file", which would silently discard the user's
 * hand-built permission list.
 */
function readSettings(settingsPath: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ClaudeSettingsError(
      `Refusing to modify ${settingsPath}: it is not valid JSON (${(err as Error).message}). ` +
        `Fix or remove the file by hand — Cairn will not overwrite it.`
    );
  }

  if (!isPlainObject(parsed)) {
    throw new ClaudeSettingsError(
      `Refusing to modify ${settingsPath}: expected a JSON object at the top level. ` +
        `Fix or remove the file by hand — Cairn will not overwrite it.`
    );
  }

  const permissions = parsed.permissions;
  if (permissions !== undefined && !isPlainObject(permissions)) {
    throw new ClaudeSettingsError(
      `Refusing to modify ${settingsPath}: "permissions" is not an object. ` +
        `Fix or remove the file by hand — Cairn will not overwrite it.`
    );
  }

  if (permissions !== undefined) {
    for (const key of ['allow', 'deny'] as const) {
      const list = permissions[key];
      if (list !== undefined && !Array.isArray(list)) {
        throw new ClaudeSettingsError(
          `Refusing to modify ${settingsPath}: "permissions.${key}" is not an array. ` +
            `Fix or remove the file by hand — Cairn will not overwrite it.`
        );
      }
    }
  }

  return parsed;
}

/**
 * Pick the rules from `incoming` that are not already represented in
 * `existing`, comparing by canonical form and deduping within `incoming`
 * itself. Returns the rules in their original, unmodified spelling.
 */
function selectNewRules(existing: unknown[], incoming: string[]): string[] {
  const seen = new Set<string>();
  for (const entry of existing) {
    // A stray non-string in the user's array is preserved on write; it just
    // cannot match anything, so skip it rather than stringifying it.
    if (typeof entry === 'string') seen.add(canonicalizeRule(entry));
  }

  const added: string[] = [];
  for (const rule of incoming) {
    const key = canonicalizeRule(rule);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(rule);
  }
  return added;
}

/**
 * Atomic replace, mirroring `writeTasksFile()` in `src/tasks-file.ts`: stage to
 * a per-process, per-call unique temp path, then rename over the target so a
 * reader never observes a partial file and two writers never share a staging
 * path. The temp file is removed if anything fails.
 */
function writeSettingsAtomic(settingsPath: string, text: string): void {
  const tmpPath = `${settingsPath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmpPath, text);
    fs.renameSync(tmpPath, settingsPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Temp file may not exist if writeFileSync itself failed; swallow ENOENT.
    }
    throw err;
  }
}

/**
 * Union `rules` into `<projectRoot>/.claude/settings.local.json`.
 *
 * Idempotent: when every supplied rule is already present the file is not
 * written at all, and the returned `addedAllow`/`addedDeny` are empty so
 * callers have nothing to report.
 *
 * Throws `ClaudeSettingsError` — without touching the file — if the existing
 * settings cannot be parsed or have an unexpected shape.
 */
export function mergeClaudeSettings(projectRoot: string, rules: PermissionRules): MergeResult {
  const settingsPath = claudeSettingsPath(projectRoot);

  // Validate before deciding anything else: a malformed file is a hard error
  // even when we had no rules to add, because staying silent would let a
  // broken permission list sit unnoticed until it denied something.
  const existing = readSettings(settingsPath);

  const permissions = (existing?.permissions as Record<string, unknown> | undefined) ?? undefined;
  const currentAllow = (permissions?.allow as unknown[] | undefined) ?? [];
  const currentDeny = (permissions?.deny as unknown[] | undefined) ?? [];

  const addedAllow = selectNewRules(currentAllow, rules.allow ?? []);
  const addedDeny = selectNewRules(currentDeny, rules.deny ?? []);

  if (addedAllow.length === 0 && addedDeny.length === 0) {
    return { created: false, addedAllow: [], addedDeny: [], settingsPath };
  }

  // Spread preserves every key we do not recognize, at both the top level and
  // inside `permissions` (defaultMode, additionalDirectories, ...).
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  const nextPermissions: Record<string, unknown> = { ...(permissions ?? {}) };

  if (addedAllow.length > 0) {
    nextPermissions.allow = [...currentAllow, ...addedAllow];
  }
  if (addedDeny.length > 0) {
    nextPermissions.deny = [...currentDeny, ...addedDeny];
  }
  next.permissions = nextPermissions;

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeSettingsAtomic(settingsPath, `${JSON.stringify(next, null, 2)}\n`);

  return { created: existing === null, addedAllow, addedDeny, settingsPath };
}
