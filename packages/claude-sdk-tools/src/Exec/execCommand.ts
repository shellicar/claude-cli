import { Readable } from 'node:stream';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { fromStream, type IExecutor } from '@shellicar/exec-core';
import { resolveSinks } from '../exec-shared';
import type { Command, StepResult } from './types';

/** Execute a single command via exec-core, routing and collecting its output. */
export async function execCommand(cmd: Command, cwd: string, abortSignal: AbortSignal | undefined, executor: IExecutor, fs: IFileSystem): Promise<StepResult> {
  const { stdout, stderr, stdoutCapture, stderrCapture } = resolveSinks(cmd, fs);

  // Collect concurrently with the run. Invoking fromStream starts the drain
  // immediately, so a full capture buffer can never block the child.
  const [status, out, err] = await Promise.all([
    executor.run({ program: cmd.program, args: cmd.args, cwd: cmd.cwd ?? cwd, env: { ...process.env, ...cmd.env } }, { stdin: cmd.stdin != null ? Readable.from(cmd.stdin) : undefined, stdout, stderr, signal: abortSignal }),
    stdoutCapture ? fromStream(stdoutCapture) : Promise.resolve(''),
    stderrCapture ? fromStream(stderrCapture) : Promise.resolve(''),
  ]);

  return { stdout: out, stderr: err, exitCode: status.exitCode, signal: status.signal };
}
