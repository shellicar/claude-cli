import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { PassThrough, Readable, type Writable } from 'node:stream';
import { fromStream, PipeConsumerGone } from '@shellicar/exec-core';
import type { EngineContext } from './engine';
import type { Command, CommandResult } from './types';

interface StageSinks {
  stdout: Writable;
  stderr: Writable;
  stdoutCapture?: PassThrough;
  stderrCapture?: PassThrough;
}

/**
 * Resolve a single stage's sinks under V3's redirect model ({ stdout?, stderr? } with
 * stderr "&1" = merge). `downstream` is the bridge a non-terminal stage feeds; when
 * present and no stdout redirect diverts it, stdout flows onward and is NOT captured.
 */
function resolveStageSinks(cmd: Command, downstream: Writable | undefined, cwd: string): StageSinks {
  const redirect = cmd.redirect;
  const mergeStderr = redirect?.stderr === '&1';

  let stdout: Writable;
  let stdoutCapture: PassThrough | undefined;
  if (redirect?.stdout != null) {
    const file = createWriteStream(resolve(cwd, redirect.stdout), { flags: 'w' });
    file.on('error', () => {
      // Redirect write errors should not crash the run.
    });
    stdout = file;
    // a terminal stage with a stdout redirect captures nothing; a non-terminal stage
    // with op "|" + stdout redirect is rejected at validation (R4), so this branch is
    // only reached on a terminal stage.
  } else if (downstream != null) {
    stdout = downstream;
  } else {
    stdoutCapture = new PassThrough();
    stdout = stdoutCapture;
  }

  let stderr: Writable;
  let stderrCapture: PassThrough | undefined;
  if (mergeStderr) {
    stderr = stdout;
  } else if (redirect?.stderr != null) {
    const file = createWriteStream(resolve(cwd, redirect.stderr), { flags: 'w' });
    file.on('error', () => {
      // Redirect write errors should not crash the run.
    });
    stderr = file;
  } else {
    stderrCapture = new PassThrough();
    stderr = stderrCapture;
  }

  return { stdout, stderr, stdoutCapture, stderrCapture };
}

/** Execute a pipeline (length ≥ 1), one CommandResult per stage. */
export async function runPipeline(commands: Command[], ctx: EngineContext): Promise<CommandResult[]> {
  const n = commands.length;
  const bridges = Array.from({ length: n - 1 }, () => {
    const bridge = new PassThrough();
    // Teardown destroys a bridge while its producer may still be piping into it; that
    // write-after-destroy emits 'error', and an unhandled stream 'error' would crash the
    // process. Swallow it — the producer is being killed anyway.
    bridge.on('error', () => {});
    return bridge;
  });

  // Each stage gets its own teardown controller. When a stage settles, the upstream
  // feeding it has nowhere left to send output, so we abort that upstream's controller,
  // driving Executor.run's existing abort → group-kill path. The kill makes the upstream
  // settle in turn, so teardown cascades one hop at a time all the way up the pipe. This
  // is the SIGPIPE analogue: without it `find | head -1` hangs, the producer blocked on
  // backpressure with no consumer.
  const controllers = commands.map(() => new AbortController());
  const settled = new Array<boolean>(n).fill(false);

  const teardownUpstreamOf = (i: number): void => {
    // An external cancel (timeout / ESC) already aborts every stage; that is not a
    // consumer-exit teardown, so it must not tear an upstream down or double-abort.
    if (ctx.signal?.aborted) {
      return;
    }
    const up = i - 1;
    // Nothing to tear down at the head; and never re-tear a stage that already exited on
    // its own, which keeps its natural exit as-is instead of a teardown SIGPIPE.
    if (up < 0 || settled[up]) {
      return;
    }
    // Destroy the bridge feeding this stage. The consumer has gone, so nothing drains the
    // bridge; the upstream is blocked on backpressure, and Executor.run's teardown awaits
    // `finished()` on that bridge before it resolves. An orphaned bridge never emits the
    // readable 'end' `finished()` waits for, so the killed producer would hang in its own
    // teardown. Destroying it forces 'close', which settles `finished()`, and unblocks the
    // producer's write so the group-kill below can take it down.
    bridges[up].destroy();
    // Abort with the PipeConsumerGone reason: Executor.run maps it to a real SIGPIPE
    // kill, so the producer dies from signal 13 and closes with `signal: 'SIGPIPE'` —
    // the honest broken-pipe death, not a SIGTERM we later relabel.
    controllers[up].abort(PipeConsumerGone);
  };

  const runs: Promise<CommandResult>[] = commands.map((cmd, i) => {
    const isLast = i === n - 1;
    const downstream = isLast ? undefined : bridges[i];
    const stageCwd = cmd.cwd ?? ctx.cwd;
    const { stdout, stderr, stdoutCapture, stderrCapture } = resolveStageSinks(cmd, downstream, stageCwd);
    const stdin: Readable | undefined = i === 0 ? (cmd.stdin != null ? Readable.from(cmd.stdin) : undefined) : bridges[i - 1];
    // Combine the external cancel with this stage's own teardown controller. Either one
    // aborting kills the stage; Executor.run honours a single signal, so merge them.
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, controllers[i].signal]) : controllers[i].signal;

    return Promise.all([ctx.executor.run({ program: cmd.program, args: cmd.args, cwd: stageCwd, env: { ...process.env, ...cmd.env } }, { stdin, stdout, stderr, signal }), stdoutCapture ? fromStream(stdoutCapture) : Promise.resolve(''), stderrCapture ? fromStream(stderrCapture) : Promise.resolve('')]).then(
      ([status, out, err]): CommandResult => {
        settled[i] = true;
        teardownUpstreamOf(i); // this stage is the consumer that just settled → stop its producer
        // A producer torn down because its consumer left really died from SIGPIPE, so it
        // closes with `signal: 'SIGPIPE'`. Report the stage's real exit as-is — the kill is
        // honest, so no relabelling is needed.
        return {
          stdout: out,
          stderr: err,
          exitCode: status.exitCode,
          signal: status.signal,
        };
      },
    );
  });

  return Promise.all(runs);
}
