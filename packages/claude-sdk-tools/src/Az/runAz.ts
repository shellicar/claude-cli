import type { IExecutor } from '@shellicar/exec-core';
import type { AzSessionCache } from './AzSessionCache';
import { runOnce, type RunResult } from '../az-shared';

/** Deps one `az` call needs: the executor to run az/az-login through, and fresh reads of the
 *  certificate and the account's tenant/client id. Nothing here is cached beyond one call's
 *  lifetime by this function itself — the login session is cached by `AzSessionCache` for as long
 *  as the token stays fresh, so a rotated certificate takes effect on the next relogin, not the
 *  next call. */
export type AzDeps = {
  executor: IExecutor;
  /** PEM (cert + private key) content for one account's reader or holder identity. */
  getCert: (account: string, identity: 'reader' | 'holder') => string;
  /** The service principal's Application (client) ID for one account's reader or holder identity. */
  getClientId: (account: string, identity: 'reader' | 'holder') => string;
  /** The Entra tenant ID the account's service principals belong to. */
  getTenantId: (account: string) => string;
};

/** Runs one `az <args>` as one account's reader or holder identity, reusing the cached login session
 *  for this identity/account (see `AzSessionCache`) instead of paying a fresh `az login` round-trip
 *  on every call. */
export async function runAz(deps: AzDeps, cache: AzSessionCache, identity: 'reader' | 'holder', account: string, args: string[], cwd: string): Promise<RunResult> {
  const session = await cache.getSession(deps, identity, account, cwd);
  if ('loginFailed' in session) {
    return session.loginFailed;
  }
  const env = { ...process.env, AZURE_CONFIG_DIR: session.configDir, AZURE_EXTENSION_DIR: session.extensionDir };
  return await runOnce(deps.executor, 'az', args, cwd, env);
}
