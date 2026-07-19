import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IExecutor } from '@shellicar/exec-core';
import { ensureAzExtensionDir, type RunResult, removeConfigDir, runOnce } from '../az-shared';

/** Deps every escalated `az repos pr` call needs: the same certificate-login mechanism the Az
 *  package's holder identity already uses for ordinary `az` commands — one identity, one
 *  credential, proven to authenticate to Azure DevOps directly (no separate PAT). Nothing here is
 *  cached beyond one call's lifetime; a rotated certificate takes effect on the very next call. */
export type AdoEscalatedDeps = {
  executor: IExecutor;
  /** PEM (cert + private key) content for the holder identity backing the ADO PR tools. */
  getCert: () => string;
  /** The holder service principal's Application (client) ID. */
  getClientId: () => string;
  /** The Entra tenant ID the holder service principal belongs to. */
  getTenantId: () => string;
};

/** Runs one `az repos pr <subcommand> <args>` as the holder identity: writes the certificate to a
 *  throwaway temp dir, `az login --service-principal --certificate` into an isolated
 *  AZURE_CONFIG_DIR scoped to that dir (never the caller's own logged-in session), runs the real
 *  command against that same config dir, then deletes the temp dir — certificate and session both
 *  gone once the call returns.
 *
 *  AZURE_EXTENSION_DIR points at a persistent, shared directory (see az-shared.ts) rather than the
 *  throwaway config dir: the `azure-devops` extension is not a credential, and re-downloading it
 *  on every single call is what made every call slow. Only the login/token cache is ephemeral. */
export async function runAdoEscalated(deps: AdoEscalatedDeps, subcommand: string[], args: string[], cwd: string): Promise<RunResult> {
  const configDir = await mkdtemp(join(tmpdir(), 'az-ado-'));
  const extensionDir = await ensureAzExtensionDir();
  try {
    const certPath = join(configDir, 'cert.pem');
    await writeFile(certPath, deps.getCert(), { mode: 0o600 });
    const env = { ...process.env, AZURE_CONFIG_DIR: configDir, AZURE_EXTENSION_DIR: extensionDir };

    const login = await runOnce(deps.executor, 'az', ['login', '--service-principal', '-u', deps.getClientId(), '--tenant', deps.getTenantId(), '--certificate', certPath, '--allow-no-subscriptions'], cwd, env);
    if (login.exitCode !== 0) {
      return login;
    }

    return await runOnce(deps.executor, 'az', ['repos', 'pr', ...subcommand, ...args], cwd, env);
  } finally {
    await removeConfigDir(configDir);
  }
}
