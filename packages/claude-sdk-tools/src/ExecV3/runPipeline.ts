import { resolve } from 'node:path';
import { PassThrough, Readable, type Writable } from 'node:stream';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { fromStream, type PipelineStage } from '@shellicar/exec-core';
import type { EngineContext } from './engine';
import type { Command, CommandResult } from './types';

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

  let stdout: Writable | undefined;
  let stdoutCapture: PassThrough | undefined;
  if (redirect?.stdout != null) {
    // A non-terminal stage with a stdout redirect is rejected at validation (R4), so this
    // is only reached on a terminal stage.
    const file = fs.createWriteStream(resolve(cwd, redirect.stdout), { flags: 'w' });
    file.on('error', () => {
      // Redirect write errors should not crash the run.
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
  if (!mergeStderr && redirect?.stderr != null) {
    const file = fs.createWriteStream(resolve(cwd, redirect.stderr), { flags: 'w' });
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
  const sinks = commands.map((cmd, i) => resolveStageSinks(cmd, i === n - 1, cmd.cwd ?? ctx.cwd, ctx.fs));

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
      return Promise.all([run, stdoutCapture ? fromStream(stdoutCapture) : Promise.resolve(''), stderrCapture ? fromStream(stderrCapture) : Promise.resolve('')]).then(([status, out, err]): CommandResult => {
        // A producer whose consumer exited dies from a kernel SIGPIPE, so its real exit is
        // already the honest broken-pipe death. Report it as-is.
        return {
          stdout: out,
          stderr: err,
          exitCode: status.exitCode,
          signal: status.signal,
          durationMs: Math.round(ctx.now() - startedAt[i]),
        };
      });
    }),
  );
}
