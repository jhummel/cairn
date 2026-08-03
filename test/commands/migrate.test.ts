import { describe, test, expect, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createProgram } from '../../src/index';

const INDEX = path.join(__dirname, '..', '..', 'src', 'index.ts');

const created: string[] = [];

afterEach(() => {
  while (created.length) {
    const dir = created.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function sh(args: string[], cwd: string) {
  return spawnSync(args[0]!, args.slice(1), { cwd, encoding: 'utf-8' });
}

/** Run the migrate command through the real CLI entry point, not the installed binary. */
function runCli(cwd: string, args: string[] = ['migrate']) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('CAIRN_') || k.startsWith('RALPH_')) continue;
    env[k] = v;
  }
  const res = spawnSync('bun', ['run', INDEX, ...args], { cwd, encoding: 'utf-8', env });
  return { ...res, output: `${res.stdout ?? ''}\n${res.stderr ?? ''}` };
}

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const LEGACY_GITIGNORE = [
  '.ralph_complete',
  '.ralph_iterations.log',
  '.ralph_prev_notes',
  '.ralph_completed_ids',
  '.ralph_tasks_snapshot.json',
  '.ralph_task_*_notes.md',
  'instructions.md',
  '',
].join('\n');

interface FixtureOptions {
  /** Task statuses written into .ralph/tasks.json. */
  statuses?: string[];
  /** Content for .ralph/.gitignore; null writes no .gitignore at all. */
  gitignore?: string | null;
  /** Files to pre-create under .claude/, keyed by path relative to .claude/. */
  claude?: Record<string, string>;
  /** Skip state.json, reviews/, audit/ and the config file (partial install). */
  partial?: boolean;
  /** Create a .cairn/ directory too (ambiguous layout). */
  alsoCairnDir?: boolean;
  /** Create no data dir and no config file at all. */
  empty?: boolean;
  /** Commit everything after creating it. */
  commit?: boolean;
}

function makeFixture(opts: FixtureOptions = {}): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-migrate-')));
  created.push(dir);

  sh(['git', 'init', '-q', '-b', 'main'], dir);
  sh(['git', 'config', 'user.email', 'test@example.com'], dir);
  sh(['git', 'config', 'user.name', 'Test'], dir);

  write(path.join(dir, 'README.md'), '# fixture\n');

  if (!opts.empty) {
    const d = path.join(dir, '.ralph');
    const statuses = opts.statuses ?? ['pending', 'complete'];
    write(
      path.join(d, 'tasks.json'),
      JSON.stringify(
        {
          project: 'fixture',
          tasks: statuses.map((status, i) => ({
            id: i + 1,
            priority: 1,
            title: `Task ${i + 1}`,
            status,
          })),
        },
        null,
        2
      )
    );
    write(path.join(d, 'tasks.completed.json'), '{"tasks":[{"id":99,"title":"old"}]}');
    write(path.join(d, 'planning-notes.md'), 'notes\n');
    const gitignore = opts.gitignore === undefined ? LEGACY_GITIGNORE : opts.gitignore;
    if (gitignore !== null) write(path.join(d, '.gitignore'), gitignore);

    // Stateful temp files (gitignored by the legacy .gitignore above).
    write(path.join(d, '.ralph_completed_ids'), '1\n2\n');
    write(path.join(d, '.ralph_prev_notes'), 'previous notes\n');
    write(path.join(d, '.ralph_iterations.log'), 'iteration 1\n');
    write(path.join(d, '.ralph_tasks_snapshot.json'), '{"tasks":[]}');
    // Scratch that must NOT be renamed.
    write(path.join(d, '.ralph_task_7_notes.md'), 'scratch\n');

    if (!opts.partial) {
      write(path.join(d, 'state.json'), '{"nextTaskId":5,"round":2}');
      write(path.join(d, 'reviews', 'round-1.md'), '# round 1\n');
      write(path.join(d, 'audit', 'findings.md'), '# audit\n');
      write(path.join(dir, 'ralph.json'), '{"projectName":"fixture"}');
    }
  }

  if (opts.alsoCairnDir) {
    write(path.join(dir, '.cairn', 'tasks.json'), '{"tasks":[]}');
  }

  for (const [rel, content] of Object.entries(opts.claude ?? {})) {
    write(path.join(dir, '.claude', rel), content);
  }

  if (opts.commit !== false) {
    sh(['git', 'add', '-A'], dir);
    sh(['git', 'commit', '-qm', 'initial'], dir);
  }
  return dir;
}

function commitCount(dir: string): number {
  const res = sh(['git', 'rev-list', '--count', 'HEAD'], dir);
  return parseInt((res.stdout ?? '0').trim(), 10);
}

function staged(dir: string): string {
  return sh(['git', 'diff', '--cached', '--name-status', '-M'], dir).stdout ?? '';
}

describe('migrate command registration', () => {
  test('createProgram registers a migrate command', () => {
    const program = createProgram();
    const migrate = program.commands.find((c) => c.name() === 'migrate');
    expect(migrate).toBeDefined();
    expect(migrate!.description().toLowerCase()).toContain('.cairn');
  });
});

describe('migrate core moves', () => {
  test('renames the data dir and the config file', () => {
    const dir = makeFixture();
    const res = runCli(dir);
    expect(res.status).toBe(0);

    expect(fs.existsSync(path.join(dir, '.cairn'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.ralph'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'cairn.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'ralph.json'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'cairn.json'), 'utf-8')).toContain('fixture');
  });

  test('renames the four stateful temp files, preserving content', () => {
    const dir = makeFixture();
    expect(runCli(dir).status).toBe(0);
    const d = path.join(dir, '.cairn');

    expect(fs.readFileSync(path.join(d, '.cairn_completed_ids'), 'utf-8')).toBe('1\n2\n');
    expect(fs.readFileSync(path.join(d, '.cairn_prev_notes'), 'utf-8')).toBe('previous notes\n');
    expect(fs.readFileSync(path.join(d, '.cairn_iterations.log'), 'utf-8')).toBe('iteration 1\n');
    expect(fs.readFileSync(path.join(d, '.cairn_tasks_snapshot.json'), 'utf-8')).toBe('{"tasks":[]}');

    for (const suffix of ['completed_ids', 'prev_notes', 'iterations.log', 'tasks_snapshot.json']) {
      expect(fs.existsSync(path.join(d, `.ralph_${suffix}`))).toBe(false);
    }
  });

  test('leaves task-notes scratch and all archive files untouched', () => {
    const dir = makeFixture();
    expect(runCli(dir).status).toBe(0);
    const d = path.join(dir, '.cairn');

    expect(fs.readFileSync(path.join(d, '.ralph_task_7_notes.md'), 'utf-8')).toBe('scratch\n');
    expect(fs.existsSync(path.join(d, '.cairn_task_7_notes.md'))).toBe(false);

    expect(fs.readFileSync(path.join(d, 'tasks.completed.json'), 'utf-8')).toContain('"id":99');
    expect(fs.readFileSync(path.join(d, 'reviews', 'round-1.md'), 'utf-8')).toBe('# round 1\n');
    expect(fs.readFileSync(path.join(d, 'audit', 'findings.md'), 'utf-8')).toBe('# audit\n');
  });

  test('stages the renames but never commits', () => {
    const dir = makeFixture();
    const before = commitCount(dir);
    expect(runCli(dir).status).toBe(0);

    expect(commitCount(dir)).toBe(before);
    const s = staged(dir);
    expect(s).toContain('.cairn/tasks.json');
    expect(s).toContain('cairn.json');
    expect(s).not.toContain('.ralph/tasks.json\n');
  });

  test('tolerates a partial install (no state.json, reviews/, or config file)', () => {
    const dir = makeFixture({ partial: true });
    const res = runCli(dir);
    expect(res.status).toBe(0);

    expect(fs.existsSync(path.join(dir, '.cairn', 'tasks.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.ralph'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'cairn.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.cairn', '.cairn_prev_notes'))).toBe(true);
  });

  test('is idempotent — a second run changes nothing and exits 0', () => {
    const dir = makeFixture();
    expect(runCli(dir).status).toBe(0);
    const stagedAfterFirst = staged(dir);

    const second = runCli(dir);
    expect(second.status).toBe(0);
    expect(second.output.toLowerCase()).toContain('nothing to do');
    expect(staged(dir)).toBe(stagedAfterFirst);
    expect(fs.existsSync(path.join(dir, '.cairn'))).toBe(true);
  });
});

describe('migrate .gitignore refresh', () => {
  const CURRENT_NAMES = [
    '.cairn_complete',
    '.cairn_iterations.log',
    '.cairn_prev_notes',
    '.cairn_task_meta',
    '.cairn_completed_ids',
    '.cairn_tasks_snapshot.json',
    '.cairn_task_*_notes.md',
  ];

  const readIgnore = (dir: string) =>
    fs.readFileSync(path.join(dir, '.cairn', '.gitignore'), 'utf-8');

  test('appends every missing .cairn_* name, keeping the legacy lines', () => {
    const dir = makeFixture();
    expect(runCli(dir).status).toBe(0);

    const lines = readIgnore(dir).split('\n');
    for (const name of CURRENT_NAMES) expect(lines).toContain(name);
    // Legacy names are still read as a fallback, so they must survive.
    for (const name of LEGACY_GITIGNORE.split('\n').filter(Boolean)) {
      expect(lines).toContain(name);
    }
    expect(lines).toContain('instructions.md');
  });

  test('is idempotent — a second run leaves the file byte-identical', () => {
    const dir = makeFixture();
    expect(runCli(dir).status).toBe(0);
    const afterFirst = readIgnore(dir);

    expect(runCli(dir).status).toBe(0);
    expect(readIgnore(dir)).toBe(afterFirst);
  });

  test('never duplicates a .cairn_* name that is already listed', () => {
    const dir = makeFixture({
      gitignore: `${LEGACY_GITIGNORE}.cairn_prev_notes\n.cairn_iterations.log\n`,
    });
    expect(runCli(dir).status).toBe(0);

    const lines = readIgnore(dir).split('\n');
    for (const name of CURRENT_NAMES) {
      expect(lines.filter((l) => l === name)).toHaveLength(1);
    }
  });

  test("appends a '# Legacy names' block when the legacy names are absent", () => {
    const dir = makeFixture({ gitignore: 'instructions.md\n' });
    expect(runCli(dir).status).toBe(0);

    const content = readIgnore(dir);
    const lines = content.split('\n');
    for (const name of CURRENT_NAMES) expect(lines).toContain(name);
    for (const name of CURRENT_NAMES) {
      expect(lines).toContain(name.replace('.cairn_', '.ralph_'));
    }
    expect(content).toContain('# Legacy names');
    // Current block first, legacy block after it.
    expect(content.indexOf('.cairn_complete')).toBeLessThan(content.indexOf('.ralph_complete'));
  });

  test('creates no .gitignore when the data dir has none', () => {
    const dir = makeFixture({ gitignore: null });
    expect(runCli(dir).status).toBe(0);

    expect(fs.existsSync(path.join(dir, '.cairn', '.gitignore'))).toBe(false);
  });

  test('stages the .gitignore edit without committing', () => {
    const dir = makeFixture();
    const before = commitCount(dir);
    expect(runCli(dir).status).toBe(0);

    expect(commitCount(dir)).toBe(before);
    expect(staged(dir)).toContain('.cairn/.gitignore');
    // The appended lines must be in the index, not just the worktree.
    const indexed = sh(['git', 'show', ':.cairn/.gitignore'], dir).stdout ?? '';
    expect(indexed).toContain('.cairn_complete');
    expect(indexed).toContain('.cairn_task_*_notes.md');
  });

  test('tolerates a fresh .cairn/ project whose .gitignore is already current', () => {
    const dir = makeFixture();
    expect(runCli(dir).status).toBe(0);
    const second = runCli(dir);

    expect(second.status).toBe(0);
    expect(second.output.toLowerCase()).toContain('nothing to do');
  });
});

describe('migrate .claude refresh', () => {
  const REPO_ROOT = path.join(__dirname, '..', '..');
  const sourceNames = (kind: 'agents' | 'commands') =>
    fs.readdirSync(path.join(REPO_ROOT, kind)).filter((f) => f.endsWith('.md'));
  const HOOKS = ['narrate.sh', 'speak.sh', 'notify.sh'];

  test('installs the full agent and command set into a project that has none', () => {
    const dir = makeFixture();
    expect(fs.existsSync(path.join(dir, '.claude'))).toBe(false);
    expect(runCli(dir).status).toBe(0);

    for (const file of sourceNames('agents')) {
      const dest = path.join(dir, '.claude', 'agents', file);
      expect(fs.readFileSync(dest, 'utf-8')).toBe(
        fs.readFileSync(path.join(REPO_ROOT, 'agents', file), 'utf-8')
      );
    }
    for (const file of sourceNames('commands')) {
      const dest = path.join(dir, '.claude', 'commands', file);
      expect(fs.readFileSync(dest, 'utf-8')).toBe(
        fs.readFileSync(path.join(REPO_ROOT, 'commands', file), 'utf-8')
      );
    }
  });

  test('stages every newly installed agent and command file', () => {
    const dir = makeFixture();
    const before = commitCount(dir);
    expect(runCli(dir).status).toBe(0);

    expect(commitCount(dir)).toBe(before);
    const s = staged(dir);
    for (const file of sourceNames('agents')) expect(s).toContain(`.claude/agents/${file}`);
    for (const file of sourceNames('commands')) expect(s).toContain(`.claude/commands/${file}`);
    // Staged, not merely on disk: the blob must be readable from the index.
    const indexed = sh(['git', 'show', ':.claude/agents/planner.md'], dir);
    expect(indexed.status).toBe(0);
    expect(indexed.stdout!.length).toBeGreaterThan(0);
  });

  test('overwrites a stale cairn-owned agent but leaves a custom one untouched', () => {
    const dir = makeFixture({
      claude: {
        'agents/planner.md': 'stale planner\n',
        'agents/frontend-code-analyzer.md': 'custom analyzer\n',
        'commands/deploy.md': 'custom command\n',
      },
    });
    expect(runCli(dir).status).toBe(0);

    expect(fs.readFileSync(path.join(dir, '.claude', 'agents', 'planner.md'), 'utf-8')).toBe(
      fs.readFileSync(path.join(REPO_ROOT, 'agents', 'planner.md'), 'utf-8')
    );
    expect(
      fs.readFileSync(path.join(dir, '.claude', 'agents', 'frontend-code-analyzer.md'), 'utf-8')
    ).toBe('custom analyzer\n');
    expect(fs.readFileSync(path.join(dir, '.claude', 'commands', 'deploy.md'), 'utf-8')).toBe(
      'custom command\n'
    );
    expect(staged(dir)).not.toContain('frontend-code-analyzer.md');
  });

  test('regenerates all three hooks for the current socket when hooks already exist', () => {
    const dir = makeFixture({
      claude: { 'hooks/narrate.sh': '#!/bin/bash\nSOCKET="/tmp/ralph-tts.sock"\n' },
    });
    expect(runCli(dir).status).toBe(0);

    const hooksDir = path.join(dir, '.claude', 'hooks');
    for (const hook of HOOKS) {
      const content = fs.readFileSync(path.join(hooksDir, hook), 'utf-8');
      expect(content).toContain('/tmp/cairn-tts.sock');
      expect(content).not.toContain('/tmp/ralph-tts.sock');
      expect(fs.statSync(path.join(hooksDir, hook)).mode & 0o100).toBeTruthy();
    }

    const s = staged(dir);
    for (const hook of HOOKS) expect(s).toContain(`.claude/hooks/${hook}`);
  });

  test('creates no hooks in a project that never had them', () => {
    const dir = makeFixture();
    expect(runCli(dir).status).toBe(0);

    expect(fs.existsSync(path.join(dir, '.claude', 'hooks'))).toBe(false);
    expect(staged(dir)).not.toContain('.claude/hooks/');
  });

  test('is idempotent — a second run reinstalls nothing and stages nothing new', () => {
    const dir = makeFixture({
      claude: { 'hooks/narrate.sh': '#!/bin/bash\nSOCKET="/tmp/ralph-tts.sock"\n' },
    });
    expect(runCli(dir).status).toBe(0);
    const stagedAfterFirst = staged(dir);

    const second = runCli(dir);
    expect(second.status).toBe(0);
    expect(second.output.toLowerCase()).toContain('nothing to do');
    expect(staged(dir)).toBe(stagedAfterFirst);
  });

  test('prints a git-status style summary of what it staged', () => {
    const dir = makeFixture();
    const out = runCli(dir).output;

    expect(out).toContain('Staged changes:');
    expect(out).toMatch(/renamed:\s+\.ralph -> \.cairn/);
    expect(out).toMatch(/renamed:\s+ralph\.json -> cairn\.json/);
    expect(out).toMatch(/modified:\s+\.cairn\/\.gitignore/);
    expect(out).toMatch(/new file:\s+\.claude\/agents\/planner\.md/);
  });

  test('refreshes artifacts in a project already on the .cairn/ layout', () => {
    const dir = makeFixture();
    expect(runCli(dir).status).toBe(0);
    // Tamper with an installed agent, then re-run: nothing to move, plenty to refresh.
    const planner = path.join(dir, '.claude', 'agents', 'planner.md');
    fs.writeFileSync(planner, 'stale\n');

    const res = runCli(dir);
    expect(res.status).toBe(0);
    expect(res.output.toLowerCase()).not.toContain('nothing to do');
    expect(fs.readFileSync(planner, 'utf-8')).toBe(
      fs.readFileSync(path.join(REPO_ROOT, 'agents', 'planner.md'), 'utf-8')
    );
  });
});

describe('migrate preflight', () => {
  test('refuses when a task is in-progress and changes nothing', () => {
    const dir = makeFixture({ statuses: ['pending', 'in-progress'] });
    const res = runCli(dir);

    expect(res.status).toBe(1);
    expect(res.output).toContain('in-progress');
    expect(fs.existsSync(path.join(dir, '.ralph'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.cairn'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'ralph.json'))).toBe(true);
  });

  test('warns but proceeds when the working tree is dirty', () => {
    const dir = makeFixture();
    fs.writeFileSync(path.join(dir, 'README.md'), '# dirty\n');

    const res = runCli(dir);
    expect(res.status).toBe(0);
    expect(res.output.toLowerCase()).toContain('working tree');
    expect(fs.existsSync(path.join(dir, '.cairn'))).toBe(true);
  });

  test('errors when the cwd is neither a Cairn nor a Ralph project', () => {
    const dir = makeFixture({ empty: true });
    const res = runCli(dir);

    expect(res.status).toBe(1);
    expect(res.output).toContain('not a');
    expect(res.output).toContain('.cairn');
  });

  test('refuses when both .ralph/ and .cairn/ exist', () => {
    const dir = makeFixture({ alsoCairnDir: true });
    const res = runCli(dir);

    expect(res.status).toBe(1);
    expect(res.output.toLowerCase()).toContain('both .ralph/ and .cairn/');
    expect(fs.existsSync(path.join(dir, '.ralph'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.cairn'))).toBe(true);
  });

  test('errors outside a git repository', () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-nogit-')));
    created.push(dir);
    write(path.join(dir, '.ralph', 'tasks.json'), '{"tasks":[]}');

    const res = runCli(dir);
    expect(res.status).toBe(1);
    expect(res.output.toLowerCase()).toContain('git');
    expect(fs.existsSync(path.join(dir, '.ralph'))).toBe(true);
  });
});
