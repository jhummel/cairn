/**
 * Process lifecycle management — ported from ralph_execute.sh lines 1-29.
 *
 * Handles signal traps, process group kills, PID tracking, and timeouts.
 * Injectable kill function for testing.
 */

export type KillFn = (pid: number, signal: NodeJS.Signals) => boolean;

export interface ProcessManagerOptions {
  kill?: KillFn;
}

export class ProcessManager {
  private pids = new Map<string, number>();
  private kill: KillFn;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private signalHandler: () => void;

  constructor(opts: ProcessManagerOptions = {}) {
    this.kill = opts.kill ?? ((pid, signal) => process.kill(pid, signal));

    this.signalHandler = () => {
      this.cleanup();
      process.exit(130);
    };

    process.on('SIGINT', this.signalHandler);
    process.on('SIGTERM', this.signalHandler);
    process.on('SIGHUP', this.signalHandler);
  }

  register(name: string, pid: number): void {
    this.pids.set(name, pid);
  }

  unregister(name: string): void {
    this.pids.delete(name);
  }

  registeredPids(): Record<string, number> {
    return Object.fromEntries(this.pids);
  }

  cleanup(): void {
    for (const [name, pid] of this.pids) {
      // Kill the process group first, then the process itself
      try { this.kill(-pid, 'SIGTERM'); } catch {}
      try { this.kill(pid, 'SIGTERM'); } catch {}
    }
    this.pids.clear();
  }

  timeout(ms: number): AbortController {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    this.timers.add(timer);

    ac.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      this.timers.delete(timer);
    });

    return ac;
  }

  dispose(): void {
    process.removeListener('SIGINT', this.signalHandler);
    process.removeListener('SIGTERM', this.signalHandler);
    process.removeListener('SIGHUP', this.signalHandler);

    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
