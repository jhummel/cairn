import { describe, expect, test, spyOn } from 'bun:test';
import { defaultStdout, defaultStderr } from '../src/cli-io';

describe('cli-io default writers', () => {
  test('defaultStdout forwards chunks verbatim to process.stdout', () => {
    const spy = spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      defaultStdout().write('hello\n');
      expect(spy).toHaveBeenCalledWith('hello\n');
    } finally {
      spy.mockRestore();
    }
  });

  test('defaultStderr forwards chunks verbatim to process.stderr', () => {
    const spy = spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      defaultStderr().write('oops');
      expect(spy).toHaveBeenCalledWith('oops');
    } finally {
      spy.mockRestore();
    }
  });
});
