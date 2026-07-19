import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { IExecutor } from '@shellicar/exec-core';

/** Azure CLI installs extensions (e.g. `azure-devops`) under AZURE_EXTENSION_DIR. Each escalated
 *  call gets its own throwaway AZURE_CONFIG_DIR for the login/token cache — that is the actual
 *  security boundary, no standing session at rest. An extension is not a credential: it is a
 *  network download, and sharing one persistent directory across every call means it installs
 *  once ever instead of once per call, which was the real cost behind every call being slow. */
const AZ_EXTENSION_DIR = join(homedir(), '.claude', 'az-extensions');

export async function ensureAzExtensionDir(): Promise<string> {
  await mkdir(AZ_EXTENSION_DIR, { recursive: true });
  return AZ_EXTENSION_DIR;
}

export type RunResult = { stdout: string; stderr: string; exitCode: number | null };

export async function runOnce(executor: IExecutor, program: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  const result = await executor.run({ program, args, cwd, env }, { stdout, stderr });
  return { stdout: Buffer.concat(stdoutChunks).toString('utf8'), stderr: Buffer.concat(stderrChunks).toString('utf8'), exitCode: result.exitCode };
}

const REMOVE_ATTEMPTS = 5;
const REMOVE_RETRY_BASE_MS = 100;

/** Azure CLI's background telemetry/update-check threads can still be writing into the config dir
 *  for a moment after the foreground command exits, racing a plain rm with ENOTEMPTY. Retry a few
 *  times with a short linear backoff before giving up — this is a timing issue on our side, not a
 *  reason to leave the temp dir behind. */
export async function removeConfigDir(dir: string): Promise<void> {
  for (let attempt = 1; attempt <= REMOVE_ATTEMPTS; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === REMOVE_ATTEMPTS) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, REMOVE_RETRY_BASE_MS * attempt));
    }
  }
}
