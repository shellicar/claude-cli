import { PassThrough } from 'node:stream';
import type { IExecutor } from '@shellicar/exec-core';
import { buildEnvFrom } from '../exec-shared';

/** Deps every escalated gh call needs: the executor to run gh through, and a fresh read of the
 *  holder token (never cached beyond one call's lifetime by this function itself). */
export type GhEscalatedDeps = {
  executor: IExecutor;
  getHolderToken: () => string;
};

/** Runs one `gh pr <subcommand> <args>` with the holder credential: GH_TOKEN set to the holder
 *  token (gh prefers it over anything ambient), built with the same strip+provide transform the
 *  reader-scoped `EnvProvider` uses — same mechanism, different config. No isolated GH_CONFIG_DIR:
 *  the token is the actual boundary (gh's own precedence rule), and a separate config dir only
 *  risks silently different behaviour (missing prefs) for no security benefit. The holder token
 *  exists only in this one call's env, for one process, then is gone. */
export async function runGhEscalated(deps: GhEscalatedDeps, subcommand: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  const env = buildEnvFrom({ strip: ['GH_TOKEN', 'GITHUB_TOKEN'], provide: { GH_TOKEN: () => deps.getHolderToken() } });

  const result = await deps.executor.run({ program: 'gh', args: ['pr', subcommand, ...args], cwd, env }, { stdout, stderr });
  return { stdout: Buffer.concat(stdoutChunks).toString('utf8'), stderr: Buffer.concat(stderrChunks).toString('utf8'), exitCode: result.exitCode };
}
