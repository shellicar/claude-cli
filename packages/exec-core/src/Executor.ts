import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Writable } from 'node:stream';
import type { CommandSpec, ExitStatus, IExecutor, SpawnOpts } from './types.js';

// End each distinct output sink exactly once — stdout and stderr may be the same
// Writable (merge). Called on process completion so collectors and downstream
// consumers see EOF.
function endSinks(opts: SpawnOpts): void {
  const seen = new Set<Writable>();
  for (const sink of [opts.stdout, opts.stderr]) {
    if (sink && !seen.has(sink)) {
      seen.add(sink);
      sink.end();
    }
  }
}

export class Executor implements IExecutor {
  readonly #pids = new Set<number>();
  readonly #onExit: () => void;

  public constructor() {
    this.#onExit = () => {
      for (const pid of this.#pids) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // ESRCH — already gone.
        }
      }
    };
    process.on('exit', this.#onExit);
  }

  public run(cmd: CommandSpec, opts: SpawnOpts = {}): Promise<ExitStatus> {
    if (!existsSync(cmd.cwd)) {
      opts.stderr?.write(`Working directory not found: ${cmd.cwd}`);
      endSinks(opts);
      return Promise.resolve({ exitCode: 126, signal: null });
    }

    const child = spawn(cmd.program, cmd.args ?? [], {
      cwd: cmd.cwd,
      env: cmd.env,
      stdio: 'pipe',
      detached: true,
      // signal/timeout are not passed to spawn — its built-in handling only
      // signals the direct child. We groupKill so the whole group is reaped.
    });

    if (child.pid != null) {
      this.#pids.add(child.pid);
    }

    if (opts.stdin) {
      opts.stdin.pipe(child.stdin);
      child.stdin.on('error', () => {
        // Expected when the child exits before the input finishes writing.
      });
    } else {
      child.stdin.end();
    }

    // Wire each output fd to its sink with end:false, so a sink shared between
    // stdout and stderr is not closed by whichever finishes first. We end the
    // distinct sinks ourselves on completion. No sink → drain to avoid blocking.
    if (opts.stdout) {
      child.stdout.pipe(opts.stdout, { end: false });
    } else {
      child.stdout.resume();
    }
    if (opts.stderr) {
      child.stderr.pipe(opts.stderr, { end: false });
    } else {
      child.stderr.resume();
    }

    const onAbort = () => {
      if (child.pid != null) {
        this.#groupKill(child.pid);
      }
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    return new Promise<ExitStatus>((resolve) => {
      let settled = false;
      const finish = (status: ExitStatus) => {
        if (settled) {
          return;
        }
        settled = true;
        if (child.pid != null) {
          this.#pids.delete(child.pid);
        }
        opts.signal?.removeEventListener('abort', onAbort);
        endSinks(opts);
        resolve(status);
      };

      child.on('close', (code, sig) => finish({ exitCode: code, signal: sig ?? null }));

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) {
          return;
        }
        opts.stderr?.write(err.code === 'ENOENT' ? `Command not found: ${cmd.program}` : err.message);
        finish({ exitCode: err.code === 'ENOENT' ? 127 : 1, signal: null });
      });
    });
  }

  #groupKill(pid: number): void {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      return;
    }
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {}
    }, 500).unref();
  }

  public [Symbol.dispose](): void {
    process.off('exit', this.#onExit);
    for (const pid of this.#pids) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {}
    }
    this.#pids.clear();
  }
}
