import { describe, it, expect } from 'bun:test';
import { isValidConfig, isValidTask } from '../src/types';

const validConfig = {
  projectName: 'my-project',
  projectDescription: 'A test project',
  healthCheck: 'npm run type-check',
  defaultTestCommand: 'bun test',
  implementationFile: 'IMPLEMENTATION.md',
  truncateText: true,
  summarize: { claudeMdPattern: '**/*.md' },
  narration: { enabled: false, voice: 'bf_emma', ntfyTopic: '' },
};

const validTask = {
  id: 1,
  priority: 5,
  title: 'Test task',
  status: 'pending' as const,
};

describe('isValidConfig', () => {
  it('accepts a complete valid config', () => {
    expect(isValidConfig(validConfig)).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidConfig(null)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isValidConfig('string')).toBe(false);
    expect(isValidConfig(42)).toBe(false);
  });

  it('rejects missing projectName', () => {
    const { projectName: _, ...rest } = validConfig;
    expect(isValidConfig(rest)).toBe(false);
  });

  it('rejects wrong type for truncateText', () => {
    expect(isValidConfig({ ...validConfig, truncateText: 'yes' })).toBe(false);
  });

  it('rejects missing summarize object', () => {
    expect(isValidConfig({ ...validConfig, summarize: undefined })).toBe(false);
  });

  it('rejects summarize with wrong claudeMdPattern type', () => {
    expect(isValidConfig({ ...validConfig, summarize: { claudeMdPattern: 123 } })).toBe(false);
  });

  it('rejects missing narration', () => {
    expect(isValidConfig({ ...validConfig, narration: undefined })).toBe(false);
  });

  it('rejects narration.enabled as non-boolean', () => {
    expect(isValidConfig({ ...validConfig, narration: { ...validConfig.narration, enabled: 'true' } })).toBe(false);
  });

  it('rejects missing narration.voice', () => {
    const { voice: _, ...narrationRest } = validConfig.narration;
    expect(isValidConfig({ ...validConfig, narration: narrationRest })).toBe(false);
  });

  it('accepts config without review field (optional)', () => {
    expect(isValidConfig(validConfig)).toBe(true);
  });

  it('accepts config with valid review.maxIterations', () => {
    expect(isValidConfig({ ...validConfig, review: { maxIterations: 3 } })).toBe(true);
  });

  it('rejects review field that is not an object', () => {
    expect(isValidConfig({ ...validConfig, review: 'invalid' })).toBe(false);
    expect(isValidConfig({ ...validConfig, review: 42 })).toBe(false);
  });

  it('rejects review without maxIterations', () => {
    expect(isValidConfig({ ...validConfig, review: {} })).toBe(false);
  });

  it('rejects review.maxIterations that is not a number', () => {
    expect(isValidConfig({ ...validConfig, review: { maxIterations: '3' } })).toBe(false);
    expect(isValidConfig({ ...validConfig, review: { maxIterations: true } })).toBe(false);
  });
});

describe('isValidTask', () => {
  it('accepts a minimal valid task', () => {
    expect(isValidTask(validTask)).toBe(true);
  });

  it('accepts a fully populated task', () => {
    const full = {
      ...validTask,
      description: 'Do something',
      directory: 'src/',
      status: 'in-progress' as const,
      files: ['src/foo.ts'],
      tests: ['bun test'],
      completedAt: '2025-01-01T00:00:00Z',
      completedBy: 'iteration-1',
      notes: 'All good',
      dependencies: [1, 2],
      model: 'sonnet' as const,
      agent: 'my-agent',
    };
    expect(isValidTask(full)).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidTask(null)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isValidTask('task')).toBe(false);
  });

  it('rejects missing id', () => {
    const { id: _, ...rest } = validTask;
    expect(isValidTask(rest)).toBe(false);
  });

  it('rejects non-number id', () => {
    expect(isValidTask({ ...validTask, id: '1' })).toBe(false);
  });

  it('rejects missing priority', () => {
    const { priority: _, ...rest } = validTask;
    expect(isValidTask(rest)).toBe(false);
  });

  it('rejects missing title', () => {
    const { title: _, ...rest } = validTask;
    expect(isValidTask(rest)).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(isValidTask({ ...validTask, status: 'done' })).toBe(false);
  });

  it('accepts all valid statuses', () => {
    for (const status of ['pending', 'in-progress', 'complete', 'blocked']) {
      expect(isValidTask({ ...validTask, status })).toBe(true);
    }
  });

  it('rejects invalid model', () => {
    expect(isValidTask({ ...validTask, model: 'gpt-4' })).toBe(false);
  });

  it('accepts valid model values', () => {
    expect(isValidTask({ ...validTask, model: 'opus' })).toBe(true);
    expect(isValidTask({ ...validTask, model: 'sonnet' })).toBe(true);
  });

  it('rejects files with non-string elements', () => {
    expect(isValidTask({ ...validTask, files: [1, 2] })).toBe(false);
  });

  it('rejects dependencies with non-number elements', () => {
    expect(isValidTask({ ...validTask, dependencies: ['1', '2'] })).toBe(false);
  });

  it('rejects non-string description', () => {
    expect(isValidTask({ ...validTask, description: 123 })).toBe(false);
  });
});
