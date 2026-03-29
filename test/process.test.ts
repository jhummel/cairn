import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ProcessManager } from '../src/process';
import type { KillFn } from '../src/process';

describe('ProcessManager', () => {
  let killCalls: Array<{ pid: number; signal: NodeJS.Signals }>;
  let mockKill: KillFn;
  let pm: ProcessManager;

  beforeEach(() => {
    killCalls = [];
    mockKill = (pid: number, signal: NodeJS.Signals) => {
      killCalls.push({ pid, signal });
      return true;
    };
    pm = new ProcessManager({ kill: mockKill });
  });

  afterEach(() => {
    pm.dispose();
  });

  describe('register / unregister', () => {
    it('tracks a registered PID', () => {
      pm.register('claude', 1234);
      expect(pm.registeredPids()).toEqual({ claude: 1234 });
    });

    it('unregisters a PID', () => {
      pm.register('claude', 1234);
      pm.unregister('claude');
      expect(pm.registeredPids()).toEqual({});
    });

    it('replaces a PID when re-registered under the same name', () => {
      pm.register('claude', 1234);
      pm.register('claude', 5678);
      expect(pm.registeredPids()).toEqual({ claude: 5678 });
    });

    it('tracks multiple named processes', () => {
      pm.register('claude', 100);
      pm.register('narrate', 200);
      expect(pm.registeredPids()).toEqual({ claude: 100, narrate: 200 });
    });
  });

  describe('cleanup', () => {
    it('kills process group then process for each registered PID', () => {
      pm.register('claude', 1000);
      pm.cleanup();

      // Should attempt group kill (-pid) then direct kill (pid)
      expect(killCalls).toEqual([
        { pid: -1000, signal: 'SIGTERM' },
        { pid: 1000, signal: 'SIGTERM' },
      ]);
    });

    it('clears all registrations after cleanup', () => {
      pm.register('claude', 1000);
      pm.register('narrate', 2000);
      pm.cleanup();

      expect(pm.registeredPids()).toEqual({});
    });

    it('kills all registered processes', () => {
      pm.register('claude', 1000);
      pm.register('narrate', 2000);
      pm.cleanup();

      const pidsKilled = killCalls.map((c) => c.pid);
      expect(pidsKilled).toContain(-1000);
      expect(pidsKilled).toContain(1000);
      expect(pidsKilled).toContain(-2000);
      expect(pidsKilled).toContain(2000);
    });

    it('swallows errors when kill fails (process already dead)', () => {
      const failKill: KillFn = () => {
        throw new Error('ESRCH');
      };
      const pm2 = new ProcessManager({ kill: failKill });
      pm2.register('claude', 1000);

      // Should not throw
      expect(() => pm2.cleanup()).not.toThrow();
      expect(pm2.registeredPids()).toEqual({});
      pm2.dispose();
    });

    it('is idempotent — second call is a no-op', () => {
      pm.register('claude', 1000);
      pm.cleanup();
      killCalls = [];

      pm.cleanup();
      expect(killCalls).toEqual([]);
    });
  });

  describe('signal handling', () => {
    it('installs signal handlers on setup', () => {
      const listeners = process.listeners('SIGINT');
      // Our handler should be present after construction
      expect(listeners.length).toBeGreaterThan(0);
    });

    it('removes signal handlers on dispose', () => {
      const beforeCount = process.listeners('SIGINT').length;
      pm.dispose();
      const afterCount = process.listeners('SIGINT').length;
      expect(afterCount).toBeLessThan(beforeCount);
    });
  });

  describe('timeout', () => {
    it('returns an AbortController that aborts after the specified ms', async () => {
      const ac = pm.timeout(50);
      expect(ac.signal.aborted).toBe(false);

      await new Promise((r) => setTimeout(r, 80));
      expect(ac.signal.aborted).toBe(true);
    });

    it('can be cancelled before it fires', async () => {
      const ac = pm.timeout(50);
      ac.abort(); // manual abort cancels the timer

      await new Promise((r) => setTimeout(r, 80));
      expect(ac.signal.aborted).toBe(true); // aborted by us, not by timeout
    });

    it('cleans up timers on dispose', async () => {
      pm.timeout(5000); // long timeout
      pm.dispose(); // should clear the timer

      // No assertion needed — if dispose doesn't clear, the test process hangs
    });
  });
});
