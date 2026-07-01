import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PassThrough, type Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { CommandSpec, ExitStatus, IExecutor, SpawnOpts } from './types.js';

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
      return { exitCode: null, signal: 'SIGTERM' };
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
        this.#groupKill(child.pid);
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

  /**
   * Run a pipeline of stages, stdout[i] → stdin[i+1], as one owned unit. Because the
   * Executor owns the whole pipeline it can do the SIGPIPE analogue itself: when a stage
   * settles, the upstream feeding it has nowhere left to send output, so its bridge is
   * destroyed and its process group is killed — which propagates upstream one hop at a
   * time. THAT is what makes `yes | head` return promptly instead of hanging until the
   * abort/timeout fires (a single-command `run()` can't own this — it never sees the
   * sibling stages).
   *
   * STARTING POINT — the teardown mechanism is verified in isolation (`yes | head`
   * resolves in ~66ms vs hanging), but this has NOT been type-checked or run against the
   * package. Rough edges to settle: exit status of a torn-down upstream (SIGTERM here vs
   * a synthesised 141/SIGPIPE), sink-flush ordering (run() awaits `finished`; this ends
   * once), and error/redirect semantics.
   */
  public async runPipeline(commands: CommandSpec[], opts: SpawnOpts = {}): Promise<ExitStatus[]> {
    const n = commands.length;
    if (n === 0) {
      return [];
    }
    if (n === 1) {
      return [await this.run(commands[0], opts)];
    }
    if (opts.signal?.aborted) {
      return commands.map(() => ({ exitCode: null, signal: 'SIGTERM' }));
    }

    const bridges = Array.from({ length: n - 1 }, () => new PassThrough());
    const children = new Array<ReturnType<typeof spawn> | null>(n).fill(null);
    const statuses = new Array<ExitStatus | null>(n).fill(null);

    // Tear down the upstream feeder of stage i: its consumer is gone, so its output has
    // nowhere to go. Destroy the bridge first (so nothing awaits an undrained stream),
    // then group-kill. Guarded by `statuses` so an already-settled stage is never killed;
    // the kill produces that stage's own 'close', which tears down ITS upstream in turn.
    const teardownUpstreamOf = (i: number): void => {
      const up = i - 1;
      if (up < 0 || statuses[up] != null) {
        return;
      }
      bridges[up]?.destroy();
      const c = children[up];
      if (c?.pid != null) {
        this.#groupKill(c.pid);
      }
    };

    const runStage = (i: number): Promise<void> =>
      new Promise<void>((resolve) => {
        const cmd = commands[i];
        const child = spawn(cmd.program, cmd.args ?? [], { cwd: cmd.cwd, env: cmd.env, stdio: 'pipe', detached: true });
        children[i] = child;
        if (child.pid != null) {
          this.#pids.add(child.pid);
        }

        // stdin: first stage from opts.stdin (or closed); later stages from the previous bridge.
        const stdinSrc = i === 0 ? opts.stdin : bridges[i - 1];
        if (stdinSrc) {
          stdinSrc.pipe(child.stdin);
          child.stdin.on('error', () => {
            // Expected: the child may exit before its input finishes writing.
          });
        } else {
          child.stdin.end();
        }

        // stdout: last stage to opts.stdout (or drained); earlier stages into the next bridge.
        const stdoutDst = i === n - 1 ? opts.stdout : bridges[i];
        if (stdoutDst) {
          child.stdout.pipe(stdoutDst, { end: false });
        } else {
          child.stdout.resume();
        }
        if (opts.stderr) {
          child.stderr.pipe(opts.stderr, { end: false });
        } else {
          child.stderr.resume();
        }

        const settle = (status: ExitStatus): void => {
          if (statuses[i] != null) {
            return;
          }
          statuses[i] = status;
          if (child.pid != null) {
            this.#pids.delete(child.pid);
          }
          teardownUpstreamOf(i); // the SIGPIPE analogue
          resolve();
        };

        child.on('close', (code, sig) => settle({ exitCode: code, signal: sig ?? null }));
        child.on('error', (err: NodeJS.ErrnoException) => {
          opts.stderr?.write(err.code === 'ENOENT' ? `Command not found: ${cmd.program}` : err.message);
          settle({ exitCode: err.code === 'ENOENT' ? 127 : 1, signal: null });
        });
      });

    const onAbort = (): void => {
      for (const c of children) {
        if (c?.pid != null) {
          this.#groupKill(c.pid);
        }
      }
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    await Promise.all(commands.map((_, i) => runStage(i)));
    opts.signal?.removeEventListener('abort', onAbort);

    // The caller owns opts.stdout/stderr (possibly the same Writable — de-dupe); end once.
    const sinks = new Set<Writable>();
    if (opts.stdout) {
      sinks.add(opts.stdout);
    }
    if (opts.stderr) {
      sinks.add(opts.stderr);
    }
    for (const sink of sinks) {
      sink.end();
    }

    // A stage torn down before its own 'close' fired leaves a null slot — treat as killed.
    return statuses.map((s) => s ?? { exitCode: null, signal: 'SIGKILL' });
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
