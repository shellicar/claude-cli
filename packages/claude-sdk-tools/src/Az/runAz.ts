import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IExecutor } from '@shellicar/exec-core';
import { ensureAzExtensionDir, removeConfigDir, type RunResult, runOnce } from '../az-shared';

/** Deps one `az` call needs: the executor to run az/az-login through, and fresh reads of the
 *  certificate and the account's tenant/client id. Nothing here is cached beyond one call's
 *  lifetime — a rotated certificate takes effect on the very next call. */
export type AzDeps = {
  executor: IExecutor;
  /** PEM (cert + private key) content for one account's reader or holder identity. */
  getCert: (account: string, identity: 'reader' | 'holder') => string;
  /** The service principal's Application (client) ID for one account's reader or holder identity. */
  getClientId: (account: string, identity: 'reader' | 'holder') => string;
  /** The Entra tenant ID the account's service principals belong to. */
  getTenantId: (account: string) => string;
};

/** Runs one `az <args>` as one account's reader or holder identity: writes the certificate to a
 *  throwaway temp dir, `az login --service-principal --certificate` into an isolated
 *  AZURE_CONFIG_DIR scoped to that dir (never the caller's own logged-in session), runs the real
 *  command against that same config dir, then deletes the temp dir — certificate and session both
 *  gone once the call returns. No standing login, nothing left at rest beyond the Keychain item
 *  `getCert` reads from.
 *
 *  AZURE_EXTENSION_DIR points at a persistent, shared directory instead of the throwaway config
 *  dir: an installed extension (e.g. azure-devops) is not a credential, and re-downloading it on
 *  every single call — because the previous call's throwaway directory is already gone — is what
 *  made every call slow. Only the login/token cache is ephemeral; the extension install is not. */
export async function runAz(deps: AzDeps, identity: 'reader' | 'holder', account: string, args: string[], cwd: string): Promise<RunResult> {
  const configDir = await mkdtemp(join(tmpdir(), 'az-'));
  const extensionDir = await ensureAzExtensionDir();
  try {
    const certPath = join(configDir, 'cert.pem');
    await writeFile(certPath, deps.getCert(account, identity), { mode: 0o600 });
    const clientId = deps.getClientId(account, identity);
    const tenantId = deps.getTenantId(account);
    const env = { ...process.env, AZURE_CONFIG_DIR: configDir, AZURE_EXTENSION_DIR: extensionDir };

    const login = await runOnce(deps.executor, 'az', ['login', '--service-principal', '-u', clientId, '--tenant', tenantId, '--certificate', certPath, '--allow-no-subscriptions'], cwd, env);
    if (login.exitCode !== 0) {
      return login;
    }

    return await runOnce(deps.executor, 'az', args, cwd, env);
  } finally {
    await removeConfigDir(configDir);
  }
}
