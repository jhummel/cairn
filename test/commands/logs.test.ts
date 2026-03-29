import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

import { runLogs } from '../../src/commands/logs';

describe('runLogs', () => {
  let tmpDir: string;
  let dataDir: string;
  let stdoutLines: string[];
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-logs-test-'));
    dataDir = tmpDir;

    stdoutLines = [];
    consoleSpy = spyOn(process.stdout, 'write').mockImplementation((data: any) => {
      stdoutLines.push(String(data));
      return true;
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true });
  });

  test('prints "No iteration log found." when log file does not exist', () => {
    const outputLines: string[] = [];
    const logSpy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      outputLines.push(args.join(' '));
    });

    try {
      runLogs(dataDir);
    } finally {
      logSpy.mockRestore();
    }

    expect(outputLines.join('\n')).toContain('No iteration log found.');
  });

  test('prints log file contents when file exists', () => {
    const logFile = path.join(dataDir, '.ralph_iterations.log');
    const logContent = '[iteration 1] done\n[iteration 2] done\n';
    fs.writeFileSync(logFile, logContent);

    const outputLines: string[] = [];
    const logSpy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      outputLines.push(args.join(' '));
    });

    try {
      runLogs(dataDir);
    } finally {
      logSpy.mockRestore();
    }

    const output = outputLines.join('\n');
    expect(output).toContain('[iteration 1] done');
    expect(output).toContain('[iteration 2] done');
  });

  test('does not print log message when file exists', () => {
    const logFile = path.join(dataDir, '.ralph_iterations.log');
    fs.writeFileSync(logFile, 'some log content\n');

    const outputLines: string[] = [];
    const logSpy = spyOn(console, 'log').mockImplementation((...args: any[]) => {
      outputLines.push(args.join(' '));
    });

    try {
      runLogs(dataDir);
    } finally {
      logSpy.mockRestore();
    }

    expect(outputLines.join('\n')).not.toContain('No iteration log found.');
  });
});
