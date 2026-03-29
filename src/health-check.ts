import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

export interface HealthCheckOpts {
  healthCheck: string;
  taskDir: string;
  projectRoot: string;
}

export interface HealthCheckResult {
  status: 'ok' | 'skipped' | 'failed';
  output?: string;
}

function shouldRunHealthCheck(healthCheck: string, cwd: string): boolean {
  if (healthCheck === 'npm run type-check') {
    const pkgPath = join(cwd, 'package.json');
    if (!existsSync(pkgPath)) return false;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return Boolean(pkg?.scripts?.['type-check']);
    } catch {
      return false;
    }
  }
  return true;
}

function runCommand(cmd: string, cwd: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', cmd], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];

    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => chunks.push(d));

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, output: Buffer.concat(chunks).toString() });
    });

    child.on('error', (err) => {
      resolve({ exitCode: 1, output: err.message });
    });
  });
}

export async function runHealthCheck(opts: HealthCheckOpts): Promise<HealthCheckResult> {
  const { healthCheck, taskDir, projectRoot } = opts;

  if (!healthCheck) {
    return { status: 'skipped' };
  }

  const cwd = taskDir ? join(projectRoot, taskDir) : projectRoot;

  if (!shouldRunHealthCheck(healthCheck, cwd)) {
    return { status: 'skipped' };
  }

  const { exitCode, output } = await runCommand(healthCheck, cwd);

  if (exitCode === 0) {
    return { status: 'ok' };
  }

  const lines = output.split('\n');
  const lastLines = lines.slice(-30).join('\n');
  const formatted = `BUILD HEALTH CHECK FAILED:\nThe codebase has errors. Review and fix these as part of your work if they're related to your task. If they're unrelated, note them in tasks.json as a new discovered task.\n\nErrors (last 30 lines):\n${lastLines}`;

  return { status: 'failed', output: formatted };
}
