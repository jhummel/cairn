import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runHealthCheck } from '../src/health-check';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `ralph-hc-test-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('runHealthCheck', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns skipped when healthCheck is empty string', async () => {
    const result = await runHealthCheck({ healthCheck: '', taskDir: '', projectRoot: tmpDir });
    expect(result).toEqual({ status: 'skipped' });
  });

  it('returns ok when command succeeds', async () => {
    const result = await runHealthCheck({
      healthCheck: 'exit 0',
      taskDir: '',
      projectRoot: tmpDir,
    });
    expect(result.status).toBe('ok');
    expect(result.output).toBeUndefined();
  });

  it('returns failed with formatted output when command fails', async () => {
    const result = await runHealthCheck({
      healthCheck: 'echo "some error" >&2 && exit 1',
      taskDir: '',
      projectRoot: tmpDir,
    });
    expect(result.status).toBe('failed');
    expect(result.output).toContain('BUILD HEALTH CHECK FAILED');
    expect(result.output).toContain('Errors (last 30 lines)');
    expect(result.output).toContain('some error');
  });

  it('captures both stdout and stderr on failure', async () => {
    const result = await runHealthCheck({
      healthCheck: 'echo "stdout line" && echo "stderr line" >&2 && exit 1',
      taskDir: '',
      projectRoot: tmpDir,
    });
    expect(result.status).toBe('failed');
    expect(result.output).toContain('stdout line');
    expect(result.output).toContain('stderr line');
  });

  it('truncates to last 30 lines on failure', async () => {
    // Generate 50 lines of output
    const cmd = "for i in $(seq 1 50); do echo \"line $i\"; done; exit 1";
    const result = await runHealthCheck({
      healthCheck: cmd,
      taskDir: '',
      projectRoot: tmpDir,
    });
    expect(result.status).toBe('failed');
    // Should have line 50 but not line 1 (only last 30)
    expect(result.output).toContain('line 50');
    expect(result.output).not.toContain('line 1\n');
    expect(result.output).not.toContain('line 20\n');
  });

  describe('npm run type-check context-aware skipping', () => {
    it('skips when no package.json in task directory', async () => {
      const result = await runHealthCheck({
        healthCheck: 'npm run type-check',
        taskDir: '',
        projectRoot: tmpDir,
      });
      expect(result).toEqual({ status: 'skipped' });
    });

    it('skips when package.json has no type-check script', async () => {
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({ scripts: { build: 'tsc' } }),
      );
      const result = await runHealthCheck({
        healthCheck: 'npm run type-check',
        taskDir: '',
        projectRoot: tmpDir,
      });
      expect(result).toEqual({ status: 'skipped' });
    });

    it('skips when package.json has no scripts field', async () => {
      writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }));
      const result = await runHealthCheck({
        healthCheck: 'npm run type-check',
        taskDir: '',
        projectRoot: tmpDir,
      });
      expect(result).toEqual({ status: 'skipped' });
    });

    it('runs when package.json has type-check script', async () => {
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({ scripts: { 'type-check': 'echo ok' } }),
      );
      const result = await runHealthCheck({
        healthCheck: 'npm run type-check',
        taskDir: '',
        projectRoot: tmpDir,
      });
      // npm run type-check won't succeed without a real npm project, but it won't be skipped
      // The key is status is NOT 'skipped'
      expect(result.status).not.toBe('skipped');
    });
  });

  describe('cargo check runs unconditionally', () => {
    it('does not skip for cargo check (no package.json guard)', async () => {
      // No package.json in tmpDir, but cargo check should still attempt to run
      const result = await runHealthCheck({
        healthCheck: 'echo "cargo placeholder" && exit 1',
        taskDir: '',
        projectRoot: tmpDir,
      });
      // Should attempt to run and fail, not skip
      expect(result.status).toBe('failed');
    });
  });

  describe('taskDir resolution', () => {
    it('runs in projectRoot when taskDir is empty', async () => {
      // Create a sentinel file in projectRoot to verify cwd
      writeFileSync(join(tmpDir, 'sentinel.txt'), 'hello');
      const result = await runHealthCheck({
        healthCheck: 'test -f sentinel.txt && exit 0 || exit 1',
        taskDir: '',
        projectRoot: tmpDir,
      });
      expect(result.status).toBe('ok');
    });

    it('runs in projectRoot/taskDir when taskDir is set', async () => {
      const subDir = join(tmpDir, 'sub');
      mkdirSync(subDir);
      writeFileSync(join(subDir, 'sentinel.txt'), 'hello');
      const result = await runHealthCheck({
        healthCheck: 'test -f sentinel.txt && exit 0 || exit 1',
        taskDir: 'sub',
        projectRoot: tmpDir,
      });
      expect(result.status).toBe('ok');
    });

    it('skips npm run type-check when subdir has no package.json', async () => {
      const subDir = join(tmpDir, 'sub');
      mkdirSync(subDir);
      // package.json with type-check is in projectRoot, but NOT in subDir
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({ scripts: { 'type-check': 'echo ok' } }),
      );
      const result = await runHealthCheck({
        healthCheck: 'npm run type-check',
        taskDir: 'sub',
        projectRoot: tmpDir,
      });
      expect(result).toEqual({ status: 'skipped' });
    });
  });
});
