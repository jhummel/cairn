import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  decidePreToolUse,
  preToolUseHookCommand,
  hookErrorLogPath,
  resolveHookErrorLogDir,
  reviewerBashPrefixes,
  type HookContext,
} from '../../src/commands/hook';
import { GIT_INSPECTION_RULES } from '../../src/claude-settings';

// Fixtures modeled on real PreToolUse payloads captured from an interactive
// `claude --dangerously-skip-permissions` session.
const PROJECT = '/tmp/probe-project';
const CTX: HookContext = {
  projectRoot: PROJECT,
  tasksFilePath: path.join(PROJECT, '.cairn', 'tasks.json'),
  reviewsDir: path.join(PROJECT, '.cairn', 'reviews'),
};

const BASE = {
  session_id: '5b0e6f1a-7c2d-4e1b-9a3f-0d2c4b6e8f10',
  transcript_path: '/Users/probe/.claude/projects/-tmp-probe-project/5b0e6f1a.jsonl',
  cwd: PROJECT,
  permission_mode: 'bypassPermissions',
  hook_event_name: 'PreToolUse',
  tool_use_id: 'toolu_01AbCdEfGhIjKlMnOpQrStUv',
};

/** Main session: no agent_id, no agent_type — the keys are absent, not null. */
function mainSession(tool_name: string, tool_input: Record<string, unknown>) {
  return { ...BASE, tool_name, tool_input };
}

function subagent(agent_type: string | undefined, tool_name: string, tool_input: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const payload: Record<string, unknown> = { ...BASE, agent_id: 'a1b2c3d4e5f6', tool_name, tool_input, ...extra };
  if (agent_type !== undefined) payload.agent_type = agent_type;
  return payload;
}

const reviewer = (tool_name: string, tool_input: Record<string, unknown>) => subagent('post-task-reviewer', tool_name, tool_input);

describe('decidePreToolUse', () => {
  describe('fast path', () => {
    test('main-session Write to tasks.json → allow', () => {
      expect(decidePreToolUse(mainSession('Write', { file_path: CTX.tasksFilePath, content: '{}' }), CTX)).toEqual({ decision: 'allow' });
    });

    test('main-session Bash → allow', () => {
      expect(decidePreToolUse(mainSession('Bash', { command: 'rm -rf build' }), CTX)).toEqual({ decision: 'allow' });
    });

    test('subagent non-Edit/Write/Bash tool → allow', () => {
      expect(decidePreToolUse(reviewer('Read', { file_path: CTX.tasksFilePath }), CTX)).toEqual({ decision: 'allow' });
    });

    test('internal helper (agent_id, no agent_type) Bash printf → allow', () => {
      const input = subagent(undefined, 'Bash', { command: "printf 'wait for it'" });
      expect('agent_type' in input).toBe(false);
      expect(decidePreToolUse(input, CTX)).toEqual({ decision: 'allow' });
    });
  });

  describe('rule 1: no subagent writes tasks.json', () => {
    test('general-purpose subagent Write to tasks.json → deny, pointing at cairn task', () => {
      const result = decidePreToolUse(subagent('general-purpose', 'Write', { file_path: CTX.tasksFilePath, content: '{}' }), CTX);
      expect(result.decision).toBe('deny');
      if (result.decision !== 'deny') throw new Error('unreachable');
      expect(result.reason).toContain('cairn task');
    });

    test('general-purpose subagent Edit to tasks.json → deny', () => {
      const result = decidePreToolUse(
        subagent('general-purpose', 'Edit', { file_path: CTX.tasksFilePath, old_string: 'a', new_string: 'b' }),
        CTX
      );
      expect(result.decision).toBe('deny');
    });

    test('a relative file_path resolving to tasks.json (against input.cwd) → deny', () => {
      const input = subagent('general-purpose', 'Write', { file_path: '../.cairn/./tasks.json', content: '{}' }, { cwd: path.join(PROJECT, 'src') });
      expect(decidePreToolUse(input, CTX).decision).toBe('deny');
    });

    test('internal helper (agent_id, no agent_type) Write to tasks.json → deny', () => {
      expect(decidePreToolUse(subagent(undefined, 'Write', { file_path: CTX.tasksFilePath, content: '' }), CTX).decision).toBe('deny');
    });

    test('custom agent Write to tasks.json → deny', () => {
      expect(decidePreToolUse(subagent('cairn-task-agent', 'Write', { file_path: CTX.tasksFilePath, content: '' }), CTX).decision).toBe('deny');
    });

    test('general-purpose subagent Write elsewhere → allow', () => {
      expect(
        decidePreToolUse(subagent('general-purpose', 'Write', { file_path: path.join(PROJECT, 'src', 'x.ts'), content: '' }), CTX)
      ).toEqual({ decision: 'allow' });
    });

    test('general-purpose subagent writing tasks.completed.json → allow (only tasks.json is contained)', () => {
      expect(
        decidePreToolUse(subagent('general-purpose', 'Write', { file_path: path.join(PROJECT, '.cairn', 'tasks.json.bak'), content: '' }), CTX)
      ).toEqual({ decision: 'allow' });
    });

    test('general-purpose subagent Bash → allow', () => {
      expect(decidePreToolUse(subagent('general-purpose', 'Bash', { command: 'bun test' }), CTX)).toEqual({ decision: 'allow' });
    });
  });

  describe('rule 2: post-task-reviewer containment', () => {
    test('Write inside reviews/ → allow', () => {
      expect(decidePreToolUse(reviewer('Write', { file_path: path.join(CTX.reviewsDir, 'round-15.md'), content: 'x' }), CTX)).toEqual({ decision: 'allow' });
    });

    test('Edit inside a nested reviews/ path, given relative → allow', () => {
      expect(decidePreToolUse(reviewer('Edit', { file_path: '.cairn/reviews/round-15.md', old_string: 'a', new_string: 'b' }), CTX)).toEqual({ decision: 'allow' });
    });

    test('Write outside reviews/ → deny', () => {
      const result = decidePreToolUse(reviewer('Write', { file_path: path.join(PROJECT, 'src', 'index.ts'), content: 'x' }), CTX);
      expect(result.decision).toBe('deny');
      if (result.decision !== 'deny') throw new Error('unreachable');
      expect(result.reason).toContain(CTX.reviewsDir);
    });

    test('Write to a sibling dir sharing the reviews prefix → deny', () => {
      expect(decidePreToolUse(reviewer('Write', { file_path: `${CTX.reviewsDir}-evil/x.md`, content: 'x' }), CTX).decision).toBe('deny');
    });

    test('Write escaping reviews/ via .. → deny', () => {
      expect(decidePreToolUse(reviewer('Write', { file_path: path.join(CTX.reviewsDir, '..', 'tasks.completed.json'), content: 'x' }), CTX).decision).toBe('deny');
    });

    test('Write with no file_path → deny', () => {
      expect(decidePreToolUse(reviewer('Write', { content: 'x' }), CTX).decision).toBe('deny');
    });

    test('Bash `git diff abc..HEAD` → allow', () => {
      expect(decidePreToolUse(reviewer('Bash', { command: 'git diff abc..HEAD' }), CTX)).toEqual({ decision: 'allow' });
    });

    test('Bash chaining only inspection commands → allow', () => {
      expect(decidePreToolUse(reviewer('Bash', { command: 'git log --oneline -5 && git show HEAD | git diff --stat\ngit status' }), CTX)).toEqual({ decision: 'allow' });
    });

    test('Bash bare `git status` → allow', () => {
      expect(decidePreToolUse(reviewer('Bash', { command: 'git status' }), CTX)).toEqual({ decision: 'allow' });
    });

    for (const command of ['git commit -m x', 'bun test', 'git diff && rm x', 'git diff; rm x', 'git diff | sh', 'git diff & rm x', 'git difftool', 'git diff > out.txt', 'git diff $(rm x)', 'git diff `rm x`', '']) {
      test(`Bash ${JSON.stringify(command)} → deny`, () => {
        const result = decidePreToolUse(reviewer('Bash', { command }), CTX);
        expect(result.decision).toBe('deny');
        if (result.decision !== 'deny') throw new Error('unreachable');
        expect(result.reason.length).toBeGreaterThan(0);
      });
    }

    // `--output=<file>` makes git diff/log/show write to any file.
    for (const command of [
      'git diff --output=x',
      'git log --output x',
      'git show HEAD --output=/tmp/y',
      'git diff "--output=x"',
      "git diff '--output' x",
      'git status && git log --output=z',
    ]) {
      test(`Bash ${JSON.stringify(command)} → deny mentioning --output`, () => {
        const result = decidePreToolUse(reviewer('Bash', { command }), CTX);
        if (result.decision !== 'deny') throw new Error('expected deny');
        expect(result.reason).toContain('--output');
      });
    }

    for (const command of ['git diff --output-indicator-new=+ HEAD~1', 'git diff --output-indicator-old=- --output-indicator-context=x', 'git log --oneline -5']) {
      test(`Bash ${JSON.stringify(command)} → allow`, () => {
        expect(decidePreToolUse(reviewer('Bash', { command }), CTX)).toEqual({ decision: 'allow' });
      });
    }

    // `$` anywhere (not just `$(`) must be denied outright: it subsumes `$(`,
    // `${…}` brace expansion (which `hasOutputOption`'s old strip-then-check
    // missed — `--output${X}=f` survived stripping as `--output{X}=f`, matching
    // neither `--output` nor `--output=`), bare `$VAR`, and `$'...'` ANSI-C quoting.
    for (const command of ['git log --output${X}=/tmp/f', 'git diff $X', "git show $'--output=x'"]) {
      test(`Bash ${JSON.stringify(command)} → deny (shell variable/expansion)`, () => {
        const result = decidePreToolUse(reviewer('Bash', { command }), CTX);
        expect(result.decision).toBe('deny');
      });
    }

    // Quoting variants of `--output=` that contain no `$` must still be caught
    // by the exact-token check in `hasOutputOption`.
    for (const command of ['git diff --output"="x', "git diff --outpu't'=x", 'git diff --output\\=x']) {
      test(`Bash ${JSON.stringify(command)} → deny mentioning --output`, () => {
        const result = decidePreToolUse(reviewer('Bash', { command }), CTX);
        if (result.decision !== 'deny') throw new Error('expected deny');
        expect(result.reason).toContain('--output');
      });
    }

    // Plain inspection commands with no `$`, redirection, or `--output` stay allowed.
    for (const command of ['git diff abc123..def456', 'git log --oneline -5', 'git status']) {
      test(`Bash ${JSON.stringify(command)} → allow (still, no $ present)`, () => {
        expect(decidePreToolUse(reviewer('Bash', { command }), CTX)).toEqual({ decision: 'allow' });
      });
    }

    test('Write to tasks.json → deny with the tasks.json reason', () => {
      const result = decidePreToolUse(reviewer('Write', { file_path: CTX.tasksFilePath, content: '' }), CTX);
      if (result.decision !== 'deny') throw new Error('expected deny');
      expect(result.reason).toContain('cairn task');
    });

    test('an agent_type merely containing the reviewer name is not the reviewer', () => {
      expect(decidePreToolUse(subagent('post-task-reviewer-2', 'Bash', { command: 'bun test' }), CTX)).toEqual({ decision: 'allow' });
    });
  });
});

describe('reviewerBashPrefixes', () => {
  test('is derived from GIT_INSPECTION_RULES', () => {
    expect(reviewerBashPrefixes()).toEqual(GIT_INSPECTION_RULES.map((r) => r.slice('Bash('.length, -':*)'.length)));
    expect(reviewerBashPrefixes()).toContain('git diff');
  });
});

describe('preToolUseHookCommand', () => {
  let projectRoot: string;
  let dataDir: string;
  let stdout: string;
  let stderr: string;
  let savedProjectRoot: string | undefined;
  const writers = () => ({
    stdout: { write: (c: string) => { stdout += c; } },
    stderr: { write: (c: string) => { stderr += c; } },
  });

  beforeEach(() => {
    // findProjectRoot honors CAIRN_PROJECT_ROOT first; never let a leaked value
    // point the error log at this repository.
    savedProjectRoot = process.env.CAIRN_PROJECT_ROOT;
    delete process.env.CAIRN_PROJECT_ROOT;
    projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-hook-')));
    dataDir = path.join(projectRoot, '.cairn');
    fs.mkdirSync(dataDir);
    stdout = '';
    stderr = '';
  });

  afterEach(() => {
    if (savedProjectRoot !== undefined) process.env.CAIRN_PROJECT_ROOT = savedProjectRoot;
    else delete process.env.CAIRN_PROJECT_ROOT;
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  const payload = (p: Record<string, unknown>) => JSON.stringify({ ...p, cwd: projectRoot });

  test('hook error log is .cairn_hook_errors.log in the data dir', () => {
    expect(hookErrorLogPath(dataDir)).toBe(path.join(dataDir, '.cairn_hook_errors.log'));
  });

  test('deny: exit 0 with the hookSpecificOutput JSON on stdout', () => {
    const code = preToolUseHookCommand({
      stdinText: payload(subagent('general-purpose', 'Write', { file_path: path.join(dataDir, 'tasks.json'), content: '{}' })),
      ...writers(),
    });
    expect(code).toBe(0);
    const out = JSON.parse(stdout);
    expect(Object.keys(out)).toEqual(['hookSpecificOutput']);
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('cairn task');
    expect(fs.existsSync(hookErrorLogPath(dataDir))).toBe(false);
  });

  test('allow: exit 0 and prints nothing', () => {
    const code = preToolUseHookCommand({
      stdinText: payload(reviewer('Bash', { command: 'git diff abc..HEAD' })),
      ...writers(),
    });
    expect(code).toBe(0);
    expect(stdout).toBe('');
  });

  test('main session is allowed without resolving any context (no data dir needed)', () => {
    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-hook-bare-')));
    try {
      const code = preToolUseHookCommand({
        stdinText: JSON.stringify({ ...mainSession('Write', { file_path: 'x', content: '' }), cwd: bare }),
        ...writers(),
      });
      expect(code).toBe(0);
      expect(stdout).toBe('');
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  test('garbage stdin → exit 1, no deny output, timestamped error appended to the log', () => {
    fs.writeFileSync(hookErrorLogPath(dataDir), 'earlier line\n');
    const code = preToolUseHookCommand({ stdinText: 'not json{', cwd: projectRoot, ...writers() });
    expect(code).toBe(1);
    expect(code).not.toBe(2);
    expect(stdout).toBe('');
    const lines = fs.readFileSync(hookErrorLogPath(dataDir), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('earlier line');
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('non-object JSON stdin → exit 1 and logged', () => {
    const code = preToolUseHookCommand({ stdinText: '[1,2]', cwd: projectRoot, ...writers() });
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(fs.readFileSync(hookErrorLogPath(dataDir), 'utf8')).toContain('pre-tool-use');
  });

  test('data dir not found → exit 1, no deny, and the bare dir is left untouched', () => {
    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-hook-bare-')));
    try {
      const code = preToolUseHookCommand({
        stdinText: JSON.stringify({ ...subagent('general-purpose', 'Write', { file_path: 'x', content: '' }), cwd: bare }),
        cwd: projectRoot,
        ...writers(),
      });
      expect(code).toBe(1);
      expect(stdout).toBe('');
      expect(fs.readdirSync(bare)).toEqual([]);
      // The error log falls back to the ordinary resolution so the failure is
      // still recorded somewhere `cairn round next` will surface it.
      expect(fs.readFileSync(hookErrorLogPath(dataDir), 'utf8')).toContain('data dir not found');
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  test('no data dir anywhere → still exit 1, never a deny, never a crash', () => {
    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-hook-bare-')));
    const otherBare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-hook-bare2-')));
    try {
      const code = preToolUseHookCommand({
        stdinText: JSON.stringify({ ...subagent('general-purpose', 'Write', { file_path: 'x', content: '' }), cwd: bare }),
        cwd: otherBare,
        ...writers(),
      });
      expect(code).toBe(1);
      expect(code).not.toBe(2);
      expect(stdout).toBe('');
      expect(fs.readdirSync(bare)).toEqual([]);
      expect(fs.readdirSync(otherBare)).toEqual([]);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
      fs.rmSync(otherBare, { recursive: true, force: true });
    }
  });

  test('a malformed cairn.json does not affect the hook (it never reads config)', () => {
    fs.writeFileSync(path.join(projectRoot, 'cairn.json'), '{ nope');
    const code = preToolUseHookCommand({
      stdinText: payload(subagent('general-purpose', 'Write', { file_path: path.join(dataDir, 'tasks.json'), content: '{}' })),
      ...writers(),
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  // A /cairn-run session started from a shell `cairn` launched inherits
  // CAIRN_PROJECT_ROOT. The hook must follow the tool call's own cwd instead,
  // or a hook aimed at project B contains it against project A's paths.
  describe('CAIRN_PROJECT_ROOT vs the payload cwd', () => {
    let envRoot: string; // project A — named by the env var
    let envDataDir: string;

    beforeEach(() => {
      envRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-hook-env-')));
      envDataDir = path.join(envRoot, '.cairn');
      fs.mkdirSync(path.join(envDataDir, 'reviews'), { recursive: true });
      fs.mkdirSync(path.join(dataDir, 'reviews'), { recursive: true });
      process.env.CAIRN_PROJECT_ROOT = envRoot;
    });

    afterEach(() => {
      fs.rmSync(envRoot, { recursive: true, force: true });
    });

    test('the tasks.json deny resolves to the payload cwd project, not the env var project', () => {
      const code = preToolUseHookCommand({
        stdinText: payload(subagent('general-purpose', 'Write', { file_path: path.join(dataDir, 'tasks.json'), content: '{}' })),
        ...writers(),
      });
      expect(code).toBe(0);
      expect(JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason).toContain(path.join(dataDir, 'tasks.json'));
    });

    test("the env var project's tasks.json is not the contained one", () => {
      const code = preToolUseHookCommand({
        stdinText: payload(subagent('general-purpose', 'Write', { file_path: path.join(envDataDir, 'tasks.json'), content: '{}' })),
        ...writers(),
      });
      expect(code).toBe(0);
      expect(stdout).toBe('');
    });

    test("the reviewer's reviews/ scope resolves to the payload cwd project", () => {
      const allowed = preToolUseHookCommand({
        stdinText: payload(reviewer('Write', { file_path: path.join(dataDir, 'reviews', 'round-1.md'), content: 'x' })),
        ...writers(),
      });
      expect(allowed).toBe(0);
      expect(stdout).toBe('');

      const denied = preToolUseHookCommand({
        stdinText: payload(reviewer('Write', { file_path: path.join(envDataDir, 'reviews', 'round-1.md'), content: 'x' })),
        ...writers(),
      });
      expect(denied).toBe(0);
      expect(JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason).toContain(path.join(dataDir, 'reviews'));
    });

    test('with no cwd in the payload, CAIRN_PROJECT_ROOT still wins', () => {
      const { cwd: _drop, ...noCwd } = subagent('general-purpose', 'Write', {
        file_path: path.join(envDataDir, 'tasks.json'),
        content: '{}',
      });
      expect('cwd' in noCwd).toBe(false);
      const code = preToolUseHookCommand({ stdinText: JSON.stringify(noCwd), ...writers() });
      expect(code).toBe(0);
      expect(JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason).toContain(path.join(envDataDir, 'tasks.json'));
    });

    test('the error log prefers the payload cwd project over the env var project', () => {
      // B (the payload cwd) has a data dir, so it wins — the fallback below is
      // reached only when B has nowhere to append.
      expect(resolveHookErrorLogDir(projectRoot, envRoot)).toBe(dataDir);
    });

    test('the error log falls back to the ordinary resolution only when the payload cwd project has no data dir', () => {
      const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-hook-bare-')));
      try {
        expect(resolveHookErrorLogDir(bare, bare)).toBe(envDataDir); // CAIRN_PROJECT_ROOT = A
      } finally {
        fs.rmSync(bare, { recursive: true, force: true });
      }
    });

    // The decision must stay pinned to the payload cwd (that is #119), but when
    // that project has no data dir there is nowhere to append — so the log, and
    // only the log, falls back to the ordinary resolution. Otherwise a hook that
    // has silently stopped containing anything looks identical to a healthy one.
    test('the fail-open error log falls back to CAIRN_PROJECT_ROOT when the payload cwd project has no data dir', () => {
      const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-hook-bare-')));
      try {
        const code = preToolUseHookCommand({
          stdinText: JSON.stringify({ ...subagent('general-purpose', 'Write', { file_path: 'x', content: '' }), cwd: bare }),
          ...writers(),
        });
        // No data dir under `bare` → fail open (exit 1, call allowed) …
        expect(code).toBe(1);
        expect(code).not.toBe(2);
        expect(stdout).toBe('');
        expect(fs.readdirSync(bare)).toEqual([]);
        // … but the failure is still recorded, in the fallback project.
        const logged = fs.readFileSync(hookErrorLogPath(envDataDir), 'utf8').trim().split('\n');
        expect(logged).toHaveLength(1);
        expect(logged[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(logged[0]).toContain('data dir not found');
        expect(logged[0]).toContain(bare);
      } finally {
        fs.rmSync(bare, { recursive: true, force: true });
      }
    });
  });

  test('a failure writing the error log is swallowed', () => {
    fs.mkdirSync(hookErrorLogPath(dataDir)); // a directory can't be appended to
    const code = preToolUseHookCommand({ stdinText: 'garbage', cwd: projectRoot, ...writers() });
    expect(code).toBe(1);
    expect(stdout).toBe('');
  });
});
