import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Merge Cairn's permission rules into a project's `.claude/settings.local.json`,
 * and retract rules an older Cairn seeded there.
 *
 * This file is not Cairn's to own: a user may have accumulated rules in it
 * through ordinary `claude` usage long before Cairn ever ran. Every operation
 * here is therefore minimal — unknown keys round-trip untouched, the user's own
 * spelling of a rule is never rewritten, a file we cannot parse is left exactly
 * as found rather than replaced with something we can, and removal takes out
 * only the exact rules it was handed.
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

export interface RemovalResult {
  /** Entries deleted from `permissions.allow`, in the spelling found on disk. */
  removedAllow: string[];
  /** Entries deleted from `permissions.deny`, in the spelling found on disk. */
  removedDeny: string[];
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

/**
 * Read-only git subcommands, enumerated one by one. `Bash(git:*)` would also
 * authorize `git commit`, `git push`, and `git reset` — an agent granted the
 * blanket rule could rewrite the very work it was asked to inspect. Every
 * consumer of this list wants inspection only, so there is exactly one list.
 */
export const GIT_INSPECTION_RULES: readonly string[] = [
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git status:*)',
  'Bash(git rev-parse:*)',
];

/**
 * Split a shell command into its trimmed, non-empty subcommands the way Claude
 * Code does before matching each one against the allowlist: on `&&`, `||`, `;`,
 * `|`, `&` and newlines.
 */
export function splitSubcommands(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||&|\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * The command prefix a `Bash(<prefix>:*)` rule grants — `'git diff'` for
 * `'Bash(git diff:*)'` — or null for any other rule shape.
 */
export function bashRulePrefix(rule: string): string | null {
  const match = /^Bash\((.+):\*\)$/s.exec(rule.trim());
  return match ? match[1] : null;
}

/**
 * Turn shell commands (a task's declared `tests`, a project's configured health
 * check) into `Bash(...)` permission rules.
 *
 * Compound entries are SPLIT on shell operators rather than emitted whole:
 * Claude Code splits a command on `&&`, `||`, `;`, `|`, `&` and newlines and
 * matches each subcommand against the allowlist independently, so a whole-string
 * rule like `Bash(cd svc && bun test:*)` could never match anything. `cd svc &&
 * bun test` therefore yields `Bash(cd svc:*)` plus `Bash(bun test:*)`. This does
 * not widen the grant beyond the declared command — the same per-subcommand
 * split is what stops `Bash(bun test:*)` from authorizing `bun test && rm -rf /`.
 *
 * Results are deduped and returned in first-seen order.
 */
export function buildCommandRules(commands: readonly (string | undefined)[]): string[] {
  const rules: string[] = [];

  for (const entry of commands) {
    // splitSubcommands drops blanks (absent/empty commands, trailing operators)
    // so we never emit an empty `Bash()` rule or a dangling separator.
    for (const cmd of splitSubcommands(entry ?? '')) {
      // Parens delimit a rule and
      // commas separate rules within a `--allowedTools` string, so a command
      // containing either cannot be expressed as one rule — drop it rather than
      // emit something that parses as a different, broader grant. The comma case
      // only matters for the CLI-string consumer, but the stricter filter is
      // shared: it can only ever drop a rule, never widen one.
      if (!cmd || /[(),]/.test(cmd)) continue;

      const rule = `Bash(${cmd}:*)`;
      if (!rules.includes(rule)) rules.push(rule);
    }
  }

  return rules;
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
 * Split `existing` into the entries that match one of `targets` (by canonical
 * form) and the entries that survive. Matched entries are reported in the exact
 * spelling found on disk, so a caller can tell the user what it actually took
 * out of their file rather than the spelling it happened to search for.
 */
function partitionRules(
  existing: unknown[],
  targets: string[]
): { kept: unknown[]; removed: string[] } {
  const doomed = new Set(targets.map(canonicalizeRule));

  const kept: unknown[] = [];
  const removed: string[] = [];
  for (const entry of existing) {
    // A stray non-string cannot match a rule; keep it rather than drop it —
    // removal must never be a chance to tidy up the user's file.
    if (typeof entry === 'string' && doomed.has(canonicalizeRule(entry))) {
      removed.push(entry);
    } else {
      kept.push(entry);
    }
  }
  return { kept, removed };
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

/**
 * Subtract `rules` from `<projectRoot>/.claude/settings.local.json` — the
 * migration counterpart to `mergeClaudeSettings`, for retracting rules an older
 * version of Cairn seeded.
 *
 * Rules are matched by canonical form, so a rule seeded as `Bash(cmd:*)` is
 * still found after the user rewrote it as `Bash(cmd *)`. Nothing else in the
 * file is touched: unrelated entries keep their order and spelling, unknown keys
 * round-trip, and a list emptied by removal has its key deleted rather than left
 * behind as `[]` — an empty `deny` we authored is noise in a file we don't own.
 *
 * No-ops without writing when the file is absent, when no rule matches, or when
 * handed an empty rule set. Throws `ClaudeSettingsError` — without touching the
 * file — if the existing settings cannot be parsed or have an unexpected shape.
 */
export function removeSettingsRules(projectRoot: string, rules: PermissionRules): RemovalResult {
  const settingsPath = claudeSettingsPath(projectRoot);
  const empty: RemovalResult = { removedAllow: [], removedDeny: [], settingsPath };

  const existing = readSettings(settingsPath);
  if (existing === null) return empty;

  const permissions = (existing.permissions as Record<string, unknown> | undefined) ?? undefined;
  const currentAllow = (permissions?.allow as unknown[] | undefined) ?? [];
  const currentDeny = (permissions?.deny as unknown[] | undefined) ?? [];

  const allow = partitionRules(currentAllow, rules.allow ?? []);
  const deny = partitionRules(currentDeny, rules.deny ?? []);

  if (allow.removed.length === 0 && deny.removed.length === 0) return empty;

  // Spread preserves every key we do not recognize, at both the top level and
  // inside `permissions` — same contract as the additive path.
  const next: Record<string, unknown> = { ...existing };
  const nextPermissions: Record<string, unknown> = { ...(permissions ?? {}) };

  for (const [key, split] of [
    ['allow', allow],
    ['deny', deny],
  ] as const) {
    if (split.removed.length === 0) continue;
    if (split.kept.length > 0) nextPermissions[key] = split.kept;
    else delete nextPermissions[key];
  }
  next.permissions = nextPermissions;

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeSettingsAtomic(settingsPath, `${JSON.stringify(next, null, 2)}\n`);

  return { removedAllow: allow.removed, removedDeny: deny.removed, settingsPath };
}
