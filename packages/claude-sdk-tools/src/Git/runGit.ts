import { PassThrough } from 'node:stream';
import type { IExecutor } from '@shellicar/exec-core';

export type GitDeps = {
  executor: IExecutor;
};

export type GitRunResult = { stdout: string; stderr: string; exitCode: number | null };

/** Runs one `git <args>` in `cwd`, no shell — every tool's `buildArgs` is the only thing that ever
 *  reaches this, so the args a call can produce are fixed at registration time, not assembled from
 *  free-form model input. */
export async function runGit(deps: GitDeps, args: string[], cwd: string): Promise<GitRunResult> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  const result = await deps.executor.run({ program: 'git', args, cwd, env: process.env }, { stdout, stderr });
  return { stdout: Buffer.concat(stdoutChunks).toString('utf8'), stderr: Buffer.concat(stderrChunks).toString('utf8'), exitCode: result.exitCode };
}
