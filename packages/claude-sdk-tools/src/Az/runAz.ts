import type { IExecutor } from '@shellicar/exec-core';
import { type RunResult, runOnce } from '../az-shared';
import type { AzSessionCache } from './AzSessionCache';
import type { AzIdentityConfig } from './tools';

/** Deps one `az` call needs: the executor to run az/az-login through, and fresh reads of the
 *  certificate and the account's tenant id/identity config. Nothing here is cached beyond one
 *  call's lifetime by this function itself — the login session is cached by `AzSessionCache` for
 *  as long as the token stays fresh (or, for interactive, until it needs a fresh sign-in), so a
 *  rotated certificate or reconfigured mechanism takes effect on the next relogin, not the next
 *  call. */
export type AzDeps = {
  executor: IExecutor;
  /** PEM (cert + private key) content for one account's reader or holder identity. Only ever
   *  called for a `cert`-mechanism identity. */
  getCert: (account: string, identity: 'reader' | 'holder') => string;
  /** The full mechanism/clientId/subscriptionIds config for one account's reader or holder identity. */
  getIdentity: (account: string, identity: 'reader' | 'holder') => AzIdentityConfig;
  /** The Entra tenant ID the account's identities belong to. */
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
