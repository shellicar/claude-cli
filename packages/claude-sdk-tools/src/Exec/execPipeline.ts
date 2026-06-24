import { createWriteStream } from 'node:fs';
import { PassThrough, Readable, type Writable } from 'node:stream';
import { type ExitStatus, fromStream, type IExecutor } from '@shellicar/exec-core';
import type { PipelineCommands, StepResult } from './types';

/**
 * Execute a pipeline of commands with stdout→stdin piping. Each stage's stdout is
 * a bridge into the next stage's stdin; exec-core ends each bridge when its
 * producer closes, giving the consumer EOF.
 *
 * V1 pipeline quirks the scenario suite pins:
 *  - redirect is ignored on non-final stages (their stdout always flows onward);
 *  - the final stage's stdout is always captured, and additionally written to the
 *    redirect file when one is present.
 */
export async function execPipeline(commands: PipelineCommands, cwd: string, abortSignal: AbortSignal | undefined, executor: IExecutor): Promise<StepResult> {
  const n = commands.length;
  const bridges = Array.from({ length: n - 1 }, () => new PassThrough());
  const lastCapture = new PassThrough();

  const runs: Promise<ExitStatus>[] = [];
  const stderrCollects: Promise<string>[] = [];

  commands.forEach((cmd, i) => {
    const isLast = i === n - 1;
    const redirect = cmd.redirect;

    const stdout: Writable = isLast ? lastCapture : bridges[i];
    if (isLast && redirect && (redirect.stream === 'stdout' || redirect.stream === 'both')) {
      const file = createWriteStream(redirect.path, { flags: redirect.append ? 'a' : 'w' });
      file.on('error', () => {});
      lastCapture.pipe(file);
    }

    let stderr: Writable;
    let stderrCapture: PassThrough | undefined;
    if (cmd.merge_stderr) {
      stderr = stdout;
    } else if (isLast && redirect && (redirect.stream === 'stderr' || redirect.stream === 'both')) {
      const file = createWriteStream(redirect.path, { flags: redirect.append ? 'a' : 'w' });
      file.on('error', () => {});
      stderr = file;
    } else {
      stderrCapture = new PassThrough();
      stderr = stderrCapture;
    }

    const stdin: Readable | undefined = i === 0 ? (cmd.stdin != null ? Readable.from(cmd.stdin) : undefined) : bridges[i - 1];
    runs.push(executor.run({ program: cmd.program, args: cmd.args, cwd: cmd.cwd ?? cwd, env: { ...process.env, ...cmd.env } }, { stdin, stdout, stderr, signal: abortSignal }));
    stderrCollects.push(stderrCapture ? fromStream(stderrCapture) : Promise.resolve(''));
  });

  const [statuses, lastOut, errs] = await Promise.all([Promise.all(runs), fromStream(lastCapture), Promise.all(stderrCollects)]);

  const lastStatus = statuses[n - 1];
  const combinedStderr = errs.filter(Boolean).join('\n');
  // A non-final stage that failed to launch (command-not-found / bad cwd) dominates;
  // a stage that ran and merely exited non-zero does not.
  const intermediateSpawnFail = statuses.slice(0, n - 1).some((s) => s.exitCode === 126 || s.exitCode === 127);

  return {
    stdout: lastOut,
    stderr: combinedStderr,
    exitCode: intermediateSpawnFail ? 127 : lastStatus.exitCode,
    signal: lastStatus.signal,
  };
}
