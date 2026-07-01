import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { PassThrough, Readable, type Writable } from 'node:stream';
import { fromStream } from '@shellicar/exec-core';
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
  const bridges = Array.from({ length: n - 1 }, () => new PassThrough());

  const runs: Promise<CommandResult>[] = commands.map((cmd, i) => {
    const isLast = i === n - 1;
    const downstream = isLast ? undefined : bridges[i];
    const stageCwd = cmd.cwd ?? ctx.cwd;
    const { stdout, stderr, stdoutCapture, stderrCapture } = resolveStageSinks(cmd, downstream, stageCwd);
    const stdin: Readable | undefined = i === 0 ? (cmd.stdin != null ? Readable.from(cmd.stdin) : undefined) : bridges[i - 1];

    return Promise.all([ctx.executor.run({ program: cmd.program, args: cmd.args, cwd: stageCwd, env: { ...process.env, ...cmd.env } }, { stdin, stdout, stderr, signal: ctx.signal }), stdoutCapture ? fromStream(stdoutCapture) : Promise.resolve(''), stderrCapture ? fromStream(stderrCapture) : Promise.resolve('')]).then(
      ([status, out, err]): CommandResult => ({
        stdout: out,
        stderr: err,
        exitCode: status.exitCode,
        signal: status.signal,
      }),
    );
  });

  return Promise.all(runs);
}
