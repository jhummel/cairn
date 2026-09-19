import * as fs from 'fs';
import * as path from 'path';
import { GIT_INSPECTION_RULES, bashRulePrefix, splitSubcommands } from '../claude-settings';
import { findDataDir, findProjectRoot, tempFilePath } from '../utils';
import { BRAND } from '../brand';
import type { Writer } from '../cli-io';

/**
 * `cairn hook pre-tool-use` — a Claude Code PreToolUse hook that mechanically
 * contains subagents under /cairn-run.
 *
 * Under /cairn-run, subagents inherit the interactive session's permission mode
 * (typically bypassPermissions), so per-agent `--allowedTools` scoping never
 * reaches them and agent frontmatter cannot express path scopes. A hook deny
 * binds even under bypass mode, so this is the containment layer.
 *
 * Payload facts (probed, not assumed):
 * - Main-session calls carry NO `agent_id` and NO `agent_type` key. Subagent
 *   calls carry `agent_id`, plus `agent_type` — 'general-purpose' for the
 *   built-in, the frontmatter `name` for custom agents.
 * - An internal Claude Code helper fires the hook with an `agent_id` but no
 *   `agent_type`. That is normal, not an error.
 * - Exit 2 surfaces as a noisy "hook error"; exit 0 with the hookSpecificOutput
 *   JSON shows the agent only the reason — so denies use the JSON form.
 * - Any other failure (exit 1, a missing binary) lets the call through
 *   silently. Internal errors therefore fail OPEN with exit 1 — never a deny,
 *   never exit 2 — and are appended to the hook-error log so `round next` can
 *   surface them.
 */

export const REVIEWER_AGENT_TYPE = 'post-task-reviewer';

export interface HookContext {
  projectRoot: string;
  tasksFilePath: string;
  reviewsDir: string;
}

export type HookDecision = { decision: 'allow' } | { decision: 'deny'; reason: string };

export type PreToolUseInput = Record<string, unknown>;

const ALLOW: HookDecision = { decision: 'allow' };
const CONTAINED_TOOLS = new Set(['Edit', 'Write', 'Bash']);

/** `.cairn_hook_errors.log` in the data dir. */
export function hookErrorLogPath(dataDir: string): string {
  return tempFilePath(dataDir, 'hook_errors.log');
}

/** Command prefixes the reviewer may run, derived from GIT_INSPECTION_RULES. */
export function reviewerBashPrefixes(): string[] {
  return GIT_INSPECTION_RULES.map(bashRulePrefix).filter((p): p is string => p !== null);
}

/**
 * True when a decision can be made without any project context: main-session
 * calls (no `agent_id` — which also covers every headless `cairn run` agent) and
 * tools this hook does not contain.
 */
export function isFastPathAllow(input: PreToolUseInput): boolean {
  return input.agent_id == null || !CONTAINED_TOOLS.has(String(input.tool_name));
}

function toolInput(input: PreToolUseInput): Record<string, unknown> {
  const ti = input.tool_input;
  return typeof ti === 'object' && ti !== null ? (ti as Record<string, unknown>) : {};
}

function resolveFilePath(input: PreToolUseInput, ctx: HookContext): string | null {
  const filePath = toolInput(input).file_path;
  if (typeof filePath !== 'string' || filePath === '') return null;
  const cwd = typeof input.cwd === 'string' ? input.cwd : ctx.projectRoot;
  return path.resolve(cwd, filePath);
}

function isInside(dir: string, target: string): boolean {
  const rel = path.relative(path.resolve(dir), target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * True when a subcommand passes git's `--output` / `--output=<file>` option,
 * which makes `git diff|log|show` write to an arbitrary file. git rejects
 * abbreviations, so the exact token suffices; `--output-indicator-*` is harmless
 * and does not match. Shell quoting characters (but not `$` — see
 * `isInspectionOnly`, which denies any `$` outright before this runs) are
 * stripped from each token first, so `"--output=x"` and `--out"put"=x` are
 * caught as the shell will deliver them.
 */
function hasOutputOption(subcommand: string): boolean {
  return subcommand
    .split(/\s+/)
    .map((token) => token.replace(/['"\\]/g, ''))
    .some((token) => token === '--output' || token.startsWith('--output='));
}

/**
 * A reviewer Bash command is allowed only when every subcommand is a git
 * inspection command. Redirection, command substitution, and any `$` are
 * refused outright: `git diff > f` and `git diff $(rm x)` start with an
 * allowed prefix but have side effects the prefix does not describe. A bare
 * `$` is denied unconditionally (not just `$(`) because `${VAR}` brace
 * expansion, `$VAR`, and `$'...'` ANSI-C quoting can all rewrite a token after
 * this check without ever containing `$(` — e.g. `--output${X}=f` would
 * survive a strip-then-compare check as `--output{X}=f`, matching neither
 * `--output` nor `--output=`, while the shell still expands `${X}` away and
 * git still writes the file.
 */
function isInspectionOnly(command: string): boolean {
  if (/[`<>$]/.test(command)) return false;
  const subcommands = splitSubcommands(command);
  if (subcommands.length === 0) return false;
  if (subcommands.some(hasOutputOption)) return false;
  const prefixes = reviewerBashPrefixes();
  return subcommands.every((cmd) => prefixes.some((p) => cmd === p || cmd.startsWith(`${p} `)));
}

/** Pure containment policy. */
export function decidePreToolUse(input: PreToolUseInput, ctx: HookContext): HookDecision {
  if (isFastPathAllow(input)) return ALLOW;
  const tool = String(input.tool_name);
  const isFileTool = tool === 'Edit' || tool === 'Write';
  const target = isFileTool ? resolveFilePath(input, ctx) : null;

  // Rule 1: no subagent writes tasks.json, whatever its agent_type.
  if (target !== null && target === path.resolve(ctx.tasksFilePath)) {
    return {
      decision: 'deny',
      reason: `Subagents may not ${tool} ${ctx.tasksFilePath} directly. Use the \`${BRAND.name} task\` subcommands (start, complete, note, set-status, add) to change task state.`,
    };
  }

  // Rule 2: the post-task reviewer writes only its reviews and runs only git inspection.
  if (input.agent_type === REVIEWER_AGENT_TYPE) {
    if (isFileTool) {
      if (target !== null && isInside(ctx.reviewsDir, target)) return ALLOW;
      return {
        decision: 'deny',
        reason: `${REVIEWER_AGENT_TYPE} may only ${tool} files inside ${ctx.reviewsDir}.`,
      };
    }
    const command = toolInput(input).command;
    if (typeof command === 'string' && isInspectionOnly(command)) return ALLOW;
    return {
      decision: 'deny',
      reason: `${REVIEWER_AGENT_TYPE} may only run read-only git inspection commands (${reviewerBashPrefixes().join(', ')}), without redirection, command substitution, shell variables/expansion (any \`$\`), or the --output option (which writes files).`,
    };
  }

  return ALLOW;
}

/** The stdout JSON form of a deny. */
export function denyOutput(reason: string): object {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

export interface PreToolUseHookCommandOpts {
  stdinText: string;
  /**
   * Fallback used to resolve the project (and so the error log) when the
   * payload carries no usable `cwd`. Resolved the ordinary way, env var first.
   * Defaults to process.cwd().
   */
  cwd?: string;
  stdout?: Writer;
  stderr?: Writer;
}

/**
 * Handler behind `cairn hook pre-tool-use`. Returns the exit code: 0 for allow
 * (nothing printed) and deny (JSON on stdout); 1 for any internal error, which
 * is logged and lets the call through.
 */
export function preToolUseHookCommand(opts: PreToolUseHookCommandOpts): number {
  const stdout = opts.stdout ?? { write: (c) => process.stdout.write(c) };
  const stderr = opts.stderr ?? { write: (c) => process.stderr.write(c) };
  const fallbackCwd = opts.cwd ?? process.cwd();
  // The tool call's own cwd, once the payload has been parsed. A /cairn-run
  // session started from a shell that `cairn` launched inherits
  // CAIRN_PROJECT_ROOT, which would otherwise win over this cwd and point the
  // hook at the wrong project — so when the payload supplies one, resolve from
  // it alone. One resolver for both the decision and the error log, so a deny
  // and its log can never name different projects.
  let payloadCwd: string | null = null;
  const resolveProjectRoot = (): string =>
    payloadCwd !== null ? findProjectRoot(payloadCwd, { ignoreEnv: true }) : findProjectRoot(fallbackCwd);
  let dataDir: string | null = null;

  try {
    const parsed: unknown = JSON.parse(opts.stdinText);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('stdin is not a JSON object');
    }
    const input = parsed as PreToolUseInput;
    if (typeof input.cwd === 'string' && input.cwd !== '') payloadCwd = input.cwd;
    if (isFastPathAllow(input)) return 0;

    const projectRoot = resolveProjectRoot();
    const resolvedDataDir = findDataDir(projectRoot);
    if (!fs.existsSync(resolvedDataDir)) {
      throw new Error(`data dir not found: ${resolvedDataDir}`);
    }
    dataDir = resolvedDataDir;

    const decision = decidePreToolUse(input, {
      projectRoot,
      tasksFilePath: path.join(dataDir, 'tasks.json'),
      reviewsDir: path.join(dataDir, 'reviews'),
    });
    if (decision.decision === 'deny') stdout.write(JSON.stringify(denyOutput(decision.reason)) + '\n');
    return 0;
  } catch (err) {
    const message = `${BRAND.name} hook pre-tool-use: ${err instanceof Error ? err.message : String(err)}`;
    try {
      stderr.write(message + '\n');
    } catch {
      // Nothing left to report to.
    }
    try {
      const logDir = dataDir ?? findDataDir(resolveProjectRoot());
      if (fs.existsSync(logDir)) {
        fs.appendFileSync(hookErrorLogPath(logDir), `${new Date().toISOString()} ${message.replace(/\n/g, ' ')}\n`);
      }
    } catch {
      // A failure to log must not turn a fail-open into a crash.
    }
    return 1;
  }
}

/** CLI entry: read the payload from stdin, decide, exit. */
export async function runPreToolUseHook(): Promise<void> {
  let stdinText = '';
  try {
    stdinText = await Bun.stdin.text();
  } catch {
    // An unreadable stdin is handled as unparseable input below.
  }
  process.exit(preToolUseHookCommand({ stdinText }));
}
