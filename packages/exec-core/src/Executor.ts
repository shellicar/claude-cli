import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { PipeConsumerGone } from './reasons.js';
import type { CommandSpec, ExitStatus, IExecutor, SpawnOpts } from './types.js';

// The kill signal for a teardown depends on why it fired: a producer whose pipe
// consumer has gone dies from SIGPIPE (so it closes with `signal: 'SIGPIPE'`, the honest
// broken-pipe death); every other abort (cancel, timeout) uses SIGTERM. The orchestrator states the reason
// on the abort; the mapping lives here because exec-core owns the kill.
function killSignal(reason: unknown): NodeJS.Signals {
  return reason === PipeConsumerGone ? 'SIGPIPE' : 'SIGTERM';
}

// The distinct output sinks of a run — stdout and stderr may be the same Writable
// (merge), so de-dupe before acting on them.
function distinctSinks(opts: SpawnOpts): Writable[] {
  const seen = new Set<Writable>();
  for (const sink of [opts.stdout, opts.stderr]) {
    if (sink) {
      seen.add(sink);
    }
  }
  return [...seen];
}

// End each distinct output sink and wait for it to finish flushing. Ending and
// waiting are one operation: resolving only once every sink has finished is the
// ordering contract a caller reading a redirect file depends on, so a caller must
// never be able to end a sink without then waiting for it. The promise form of
// `finished` resolves on finish and rejects on error; swallow the rejection so a
// broken sink cannot hang or fail the await.
async function closeSinks(opts: SpawnOpts): Promise<void> {
  await Promise.all(
    distinctSinks(opts).map((sink) => {
      sink.end();
      return finished(sink).catch(() => {});
    }),
  );
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

  public async run(cmd: CommandSpec, opts: SpawnOpts = {}): Promise<ExitStatus> {
    // An already-aborted signal never fires 'abort', so the listener below would
    // not catch it. Without this guard a chained command that inherits the
    // aborted signal still spawns — defeating ESC-cancel. Return the same killed
    // status the group-kill path produces (SIGTERM, no exit code).
    if (opts.signal?.aborted) {
      await closeSinks(opts);
      return { exitCode: null, signal: killSignal(opts.signal.reason) };
    }

    if (!existsSync(cmd.cwd)) {
      opts.stderr?.write(`Working directory not found: ${cmd.cwd}`);
      await closeSinks(opts);
      return { exitCode: 126, signal: null };
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
        this.#groupKill(child.pid, killSignal(opts.signal?.reason));
      }
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    return await new Promise<ExitStatus>((resolve) => {
      let settled = false;
      const finish = async (status: ExitStatus): Promise<void> => {
        if (settled) {
          return;
        }
        settled = true;
        if (child.pid != null) {
          this.#pids.delete(child.pid);
        }
        opts.signal?.removeEventListener('abort', onAbort);
        await closeSinks(opts);
        resolve(status);
      };

      child.on('close', (code, sig) => void finish({ exitCode: code, signal: sig ?? null }));

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) {
          return;
        }
        opts.stderr?.write(err.code === 'ENOENT' ? `Command not found: ${cmd.program}` : err.message);
        void finish({ exitCode: err.code === 'ENOENT' ? 127 : 1, signal: null });
      });
    });
  }

  #groupKill(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
    try {
      process.kill(-pid, signal);
    } catch {
      return;
    }
    // If the process ignores the signal (a producer that handles SIGPIPE), the SIGKILL
    // below reaps it after the grace period, and it then reports SIGKILL, not SIGPIPE.
    // That is honest: a program that chose to handle the broken pipe did not die of it.
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
