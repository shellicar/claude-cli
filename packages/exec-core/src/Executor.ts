import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import type { CommandSpec, ExitStatus, IExecutor, PipelineOpts, PipelineStage, SpawnOpts } from './types.js';

// End each distinct output sink and wait for it to finish flushing. Ending and
// waiting are one operation: resolving only once every sink has finished is the
// ordering contract a caller reading a redirect file depends on, so a caller must
// never be able to end a sink without then waiting for it. Sinks are de-duped because
// stdout and stderr may be the same Writable (merge). The promise form of `finished`
// resolves on finish and rejects on error; swallow the rejection so a broken sink
// cannot hang or fail the await.
async function closeSinks(sinks: (Writable | undefined)[]): Promise<void> {
  const distinct = new Set<Writable>();
  for (const sink of sinks) {
    if (sink) {
      distinct.add(sink);
    }
  }
  await Promise.all(
    [...distinct].map((sink) => {
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
    // status the group-kill path produces (no exit code).
    if (opts.signal?.aborted) {
      await closeSinks([opts.stdout, opts.stderr]);
      return { exitCode: null, signal: 'SIGTERM' };
    }

    if (!existsSync(cmd.cwd)) {
      opts.stderr?.write(`Working directory not found: ${cmd.cwd}`);
      await closeSinks([opts.stdout, opts.stderr]);
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
        await closeSinks([opts.stdout, opts.stderr]);
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
   * Stages are joined by real OS pipes: stage i is spawned with stage i+1's stdin fd as its
   * own stdout, so the two children are connected in the kernel and this process never sees
   * the bytes. That is what makes the pipe behave: the kernel applies backpressure, and it
   * delivers SIGPIPE to a producer the instant its consumer exits. Nothing here has to
   * notice a consumer leaving, because nothing here is in the middle.
   */
  public runPipeline(stages: PipelineStage[], opts: PipelineOpts = {}): Promise<ExitStatus>[] {
    const n = stages.length;
    if (n === 1) {
      const only = stages[0];
      return [this.run(only.cmd, { stdin: opts.stdin, stdout: only.stdout, stderr: only.mergeStderr ? only.stdout : only.stderr, signal: opts.signal })];
    }

    const settle = new Array<(status: ExitStatus) => void>(n);
    const settled = new Array<boolean>(n).fill(false);
    const results = stages.map(
      (_, i) =>
        new Promise<ExitStatus>((resolve) => {
          settle[i] = resolve;
        }),
    );

    // A stage's own sinks are closed when its process closes. Every sink here is either a
    // capture the caller drains or a file, so this can never wait on a reader that has gone.
    const finish = async (i: number, status: ExitStatus): Promise<void> => {
      if (settled[i]) {
        return;
      }
      settled[i] = true;
      await closeSinks([stages[i].stdout, stages[i].stderr]);
      settle[i](status);
    };

    if (opts.signal?.aborted) {
      for (let i = 0; i < n; i++) {
        void finish(i, { exitCode: null, signal: 'SIGTERM' });
      }
      return results;
    }

    const children = new Array<ChildProcess | undefined>(n);

    // Spawn from the tail, because a stage's stdout IS its consumer's stdin fd and that fd
    // only exists once the consumer has been spawned.
    for (let i = n - 1; i >= 0; i--) {
      const stage = stages[i];
      if (!existsSync(stage.cmd.cwd)) {
        stage.stderr?.write(`Working directory not found: ${stage.cmd.cwd}`);
        void finish(i, { exitCode: 126, signal: null });
        continue;
      }
      // A terminal stage's stdout comes back to the parent to be captured or redirected. A
      // non-terminal stage writes into its consumer's stdin. Where that consumer never started,
      // the parent takes the read end itself only to close it below, so the producer meets a
      // pipe with no reader instead of writing into nothing until the run is cancelled.
      const stdout: 'pipe' | Writable = i === n - 1 ? 'pipe' : (children[i + 1]?.stdin ?? 'pipe');
      const child = spawn(stage.cmd.program, stage.cmd.args ?? [], {
        cwd: stage.cmd.cwd,
        env: stage.cmd.env,
        detached: true,
        stdio: ['pipe', stdout, stage.mergeStderr ? stdout : 'pipe'],
      });
      children[i] = child;
      if (child.pid != null) {
        this.#pids.add(child.pid);
      }
    }

    // Drop this process's copy of each write end now that the producer holds its own. While
    // the parent still holds one, the pipe has a writer here and the consumer never sees EOF.
    for (let i = 1; i < n; i++) {
      children[i]?.stdin?.destroy();
    }

    const head = children[0];
    if (head?.stdin) {
      if (opts.stdin) {
        opts.stdin.pipe(head.stdin);
        head.stdin.on('error', () => {
          // Expected when the child exits before the input finishes writing.
        });
      } else {
        head.stdin.end();
      }
    }

    for (let i = 0; i < n; i++) {
      const child = children[i];
      if (!child) {
        continue;
      }
      const stage = stages[i];
      const isLast = i === n - 1;

      if (child.stdout) {
        if (isLast) {
          if (stage.stdout) {
            child.stdout.pipe(stage.stdout, { end: false });
          } else {
            child.stdout.resume();
          }
        } else {
          // A non-terminal stage only has a parent-side stdout when its consumer never
          // started. Closing the sole read end gives it the broken pipe it would have got
          // from a consumer that started and died.
          child.stdout.destroy();
        }
      }
      if (child.stderr) {
        const sink = stage.mergeStderr ? stage.stdout : stage.stderr;
        if (sink) {
          child.stderr.pipe(sink, { end: false });
        } else {
          child.stderr.resume();
        }
      }

      child.on('close', (code, sig) => {
        if (child.pid != null) {
          this.#pids.delete(child.pid);
        }
        // Forget the child so a later abort cannot signal a process group this pid no longer
        // names. Nothing else reads `children` after the wiring above.
        children[i] = undefined;
        void finish(i, { exitCode: code, signal: sig ?? null });
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (settled[i]) {
          return;
        }
        stage.stderr?.write(err.code === 'ENOENT' ? `Command not found: ${stage.cmd.program}` : err.message);
        void finish(i, { exitCode: err.code === 'ENOENT' ? 127 : 1, signal: null });
      });
    }

    const onAbort = () => {
      for (const child of children) {
        if (child?.pid != null) {
          this.#groupKill(child.pid);
        }
      }
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    void Promise.all(results).then(() => opts.signal?.removeEventListener('abort', onAbort));

    return results;
  }

  #groupKill(pid: number): void {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      return;
    }
    // A process that ignores SIGTERM is reaped by the SIGKILL below after the grace period.
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
