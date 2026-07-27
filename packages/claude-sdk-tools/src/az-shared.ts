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

/** Platform-appropriate persistent-data directory, mirroring the OS convention (honours
 *  $XDG_DATA_HOME if set, else each OS's real default) — used only for the interactive-login
 *  session cache below, not for anything else this package persists. */
function platformDataDir(appName: string): string {
  if (process.env.XDG_DATA_HOME) {
    return join(process.env.XDG_DATA_HOME, appName);
  }
  switch (process.platform) {
    case 'darwin':
      return join(homedir(), 'Library', 'Application Support', appName);
    case 'win32':
      return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), appName);
    default:
      return join(homedir(), '.local', 'share', appName);
  }
}

/** Stable (never torn down) `AZURE_CONFIG_DIR` for one account/identity's interactive-login
 *  session — reused across CLI restarts so `az`'s own MSAL token cache inside it survives a restart
 *  without forcing a fresh interactive sign-in (MFA/CA prompt) every time. Cert-SP identities never
 *  use this: their relogin is silent and cheap, so they get a fresh throwaway dir per login instead
 *  (see `AzSessionCache`). */
export async function ensureAzInteractiveSessionDir(account: string, identity: 'reader' | 'holder'): Promise<string> {
  const dir = join(platformDataDir('claude-sdk-cli'), 'az-sessions', `${account}-${identity}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Ambient Azure credential env vars every az call this package builds must never inherit — the
 *  same class ExecV3's EnvProvider strips for model-driven calls (see apps/claude-sdk-cli's
 *  EnvProvider.ts), applied here too since the CLI's own session/command env is built directly
 *  from `process.env`, outside that app-level stripping. Without this, an ambient
 *  AZURE_CLIENT_SECRET/AZURE_CLIENT_CERTIFICATE_PATH/AZURE_PASSWORD in the CLI's own environment
 *  could still steer a login this package believes it fully controls. */
const AMBIENT_AZURE_STRIP_KEYS = ['AZURE_DEVOPS_EXT_PAT', 'AZURE_CLIENT_SECRET', 'AZURE_PASSWORD', 'AZURE_CLIENT_CERTIFICATE_PATH'];

export function stripAmbientAzureEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned = { ...env };
  for (const key of AMBIENT_AZURE_STRIP_KEYS) {
    delete cleaned[key];
  }
  return cleaned;
}

export type RunResult = { stdout: string; stderr: string; exitCode: number | null };

/** `mirror`, when true, also writes each chunk straight to the CLI's own stdout/stderr as it
 *  arrives, in addition to the normal buffered capture. Needed for an interactive `az login`: if
 *  `az` falls back to the device-code flow (no browser available — SSH, headless), the "enter this
 *  code" prompt only ever exists in that live output. Buffered-only capture hides it until the
 *  process exits, and it never will — device code waits on the human reading that exact line. */
export async function runOnce(executor: IExecutor, program: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal, mirror = false): Promise<RunResult> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  stdout.on('data', (chunk: Buffer) => {
    stdoutChunks.push(chunk);
    if (mirror) {
      process.stdout.write(chunk);
    }
  });
  stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
    if (mirror) {
      process.stderr.write(chunk);
    }
  });

  const result = await executor.run({ program, args, cwd, env }, { stdout, stderr, signal });
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
