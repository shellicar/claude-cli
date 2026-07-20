import { PassThrough } from 'node:stream';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import type { IExecutor } from '@shellicar/exec-core';

export type GitDeps = {
  executor: IExecutor;
  fs: IFileSystem;
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

/** Every Git_* tool runs exactly one git invocation — unlike ExecV3, there is no chain whose next
 *  step reads a prior exit code, so a `{ stdout, stderr, exitCode }` object buys nothing and costs
 *  real readability: git's own text (a diff, a log, a branch list) gets \n- and "-escaped into a
 *  JSON string value, which is strictly worse to read than the same text unwrapped. git often
 *  writes real, non-error content to stderr even on success (`switch`'s "Switched to branch",
 *  fetch/push progress), so both streams are merged into one block rather than one silently
 *  dropped. A non-zero exit throws with that same merged text, consistent with how this tool's own
 *  guard refusals already surface — git's own failure is not a distinct case to special-case. */
export async function runGitText(deps: GitDeps, args: string[], cwd: string): Promise<string> {
  const result = await runGit(deps, args, cwd);
  const parts = [result.stdout.trim(), result.stderr.trim()].filter((part) => part.length > 0);
  const merged = parts.join('\n');
  if (result.exitCode !== 0) {
    throw new Error(merged.length > 0 ? merged : `git ${args.join(' ')} failed with exit code ${result.exitCode}`);
  }
  return merged;
}
