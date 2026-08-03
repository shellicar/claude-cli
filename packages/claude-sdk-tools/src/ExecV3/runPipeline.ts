import { resolve } from 'node:path';
import { PassThrough, Readable, type Writable } from 'node:stream';
import { canonicalisePath } from '@shellicar/claude-core/fs/canonicalisePath';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { type DrainedStream, drainToString, type PipelineStage } from '@shellicar/exec-core';
import type { EngineContext } from './engine';
import type { Command, CommandResult } from './types';

/**
 * How much of one stream a result will carry. Not a policy about how much output a command may
 * produce: it is a backstop, set far above anything a caller reads and far below the point where
 * building the string fails outright. `yes` clears half a gigabyte in under a second, and
 * unbounded that ends the whole call with a message about string lengths.
 */
const CAPTURE_LIMIT_BYTES = 8 * 1024 * 1024;

/** Truncation is never silent: the text says so, and says how much there was. */
function captured(drained: DrainedStream): string {
  return drained.truncated ? `${drained.text}\n[truncated: kept ${CAPTURE_LIMIT_BYTES} bytes of ${drained.bytes}]` : drained.text;
}

interface StageSinks {
  stdout?: Writable;
  stderr?: Writable;
  stdoutCapture?: PassThrough;
  stderrCapture?: PassThrough;
}

/**
 * Resolve one stage's sinks under V3's redirect model ({ stdout?, stderr? } with stderr "&1"
 * = merge). A non-terminal stage has no stdout sink at all: its stdout is an OS pipe into the
 * next stage, so those bytes never reach this process and are not captured.
 */
function resolveStageSinks(cmd: Command, isLast: boolean, cwd: string, fs: IFileSystem): StageSinks {
  const redirect = cmd.redirect;
  const mergeStderr = redirect?.stderr === '&1';
  const stdoutPath = redirect?.stdout;
  const stderrPath = mergeStderr ? undefined : redirect?.stderr;
  const stdoutTarget = stdoutPath != null ? resolve(cwd, stdoutPath) : undefined;
  const stderrTarget = stderrPath != null ? resolve(cwd, stderrPath) : undefined;

  // Validation (R5) already refuses the same path written twice, but it runs before any cwd is
  // known, so all it can compare is the two strings. What matters is where each path lands: two
  // spellings, or two symlinks, can name one file, and two streams on one file each open at
  // offset zero, so one silently overwrites the other. Canonicalising answers that, and it works
  // on a target that does not exist yet, which a redirect target usually does not.
  if (stdoutPath != null && stderrPath != null) {
    const stdoutFile = canonicalisePath(stdoutPath, fs, cwd);
    const stderrFile = canonicalisePath(stderrPath, fs, cwd);
    if (stdoutFile === stderrFile) {
      throw new Error(`stdout and stderr both resolve to ${stdoutFile}; use stderr: "&1" to merge them`);
    }
  }

  let stdout: Writable | undefined;
  let stdoutCapture: PassThrough | undefined;
  if (stdoutTarget != null) {
    // A non-terminal stage with a stdout redirect is rejected at validation (R4), so this
    // is only reached on a terminal stage.
    const file = fs.openWriteStream(stdoutTarget, { flags: 'w' });
    file.on('error', () => {
      // A write that fails after the file opened should not crash the run.
    });
    stdout = file;
  } else if (isLast) {
    stdoutCapture = new PassThrough();
    stdout = stdoutCapture;
  }

  // A merged stage still gets a capture. Its child's stderr goes to stdout, but a stage that
  // never starts has no child and no fd 2 to merge, and the executor's account of why still
  // has to reach the caller on the stage that failed.
  let stderr: Writable | undefined;
  let stderrCapture: PassThrough | undefined;
  if (stderrTarget != null) {
    const file = fs.openWriteStream(stderrTarget, { flags: 'w' });
    file.on('error', () => {
      // A write that fails after the file opened should not crash the run.
    });
    stderr = file;
  } else {
    stderrCapture = new PassThrough();
    stderr = stderrCapture;
  }

  return { stdout, stderr, stdoutCapture, stderrCapture };
}

/**
 * A redirect that cannot be opened stops the pipeline before anything is spawned. The stage
 * owning the redirect reports why; the others report that they never started. Running them
 * anyway is what let a command whose output went nowhere still be reported as a success.
 */
function neverStarted(count: number, failed: number, reason: string): CommandResult[] {
  return Array.from({ length: count }, (_, i) => ({
    stdout: '',
    stderr: i === failed ? reason : 'not started: another stage in this pipeline could not open its redirect',
    exitCode: 1,
    signal: null,
    durationMs: 0,
  }));
}

/** Execute a pipeline (length ≥ 1), one CommandResult per stage. */
export async function runPipeline(commands: Command[], ctx: EngineContext): Promise<CommandResult[]> {
  const n = commands.length;

  const sinks: StageSinks[] = [];
  for (const [i, cmd] of commands.entries()) {
    try {
      sinks.push(resolveStageSinks(cmd, i === n - 1, cmd.cwd ?? ctx.cwd, ctx.fs));
    } catch (error) {
      for (const opened of sinks) {
        opened.stdout?.end();
        opened.stderr?.end();
      }
      return neverStarted(n, i, error instanceof Error ? error.message : String(error));
    }
  }

  const stages: PipelineStage[] = commands.map((cmd, i) => ({
    cmd: { program: cmd.program, args: cmd.args, cwd: cmd.cwd ?? ctx.cwd, env: ctx.envProvider.buildEnv(cmd.env) },
    stdout: sinks[i].stdout,
    stderr: sinks[i].stderr,
    mergeStderr: cmd.redirect?.stderr === '&1',
  }));

  // Only the head can take a caller-supplied stdin; validation rejects it on a pipe target (NE2).
  const stdin = commands[0].stdin != null ? Readable.from(commands[0].stdin) : undefined;

  const runs = ctx.executor.runPipeline(stages, { stdin, signal: ctx.signal });
  // Every stage starts together, so each start is read before any of them can settle. That is
  // what makes a pipe's durations overlap rather than sum.
  const startedAt = runs.map(() => ctx.now());

  return Promise.all(
    runs.map((run, i) => {
      const { stdoutCapture, stderrCapture } = sinks[i];
      const empty: DrainedStream = { text: '', bytes: 0, truncated: false };
      return Promise.all([run, stdoutCapture ? drainToString(stdoutCapture, CAPTURE_LIMIT_BYTES) : Promise.resolve(empty), stderrCapture ? drainToString(stderrCapture, CAPTURE_LIMIT_BYTES) : Promise.resolve(empty)]).then(([status, out, err]): CommandResult => {
        // A producer whose consumer exited dies from a kernel SIGPIPE, so its real exit is
        // already the honest broken-pipe death. Report it as-is.
        return {
          stdout: captured(out),
          stderr: captured(err),
          exitCode: status.exitCode,
          signal: status.signal,
          durationMs: Math.round(ctx.now() - startedAt[i]),
        };
      });
    }),
  );
}
