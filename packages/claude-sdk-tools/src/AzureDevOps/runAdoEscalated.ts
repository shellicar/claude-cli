import type { AzSessionCache } from '../Az/AzSessionCache';
import type { AzDeps } from '../Az/runAz';
import { type RunResult, runOnce, stripAmbientAzureEnv } from '../az-shared';

/** ADO PR tool calls always run as the holder identity — same deps shape `AzCli`/`EscalatedAzCli`
 *  use (`AzDeps`), since it's the same credential mechanism: one certificate, proven to
 *  authenticate to Azure DevOps directly, no separate PAT. A plain alias, not a narrower type: the
 *  same `AzDeps` object the app builds for `EscalatedAzCli` is reused verbatim here, so there is
 *  only ever one place that reads a certificate/clientId/tenantId out of config or Keychain. */
export type AdoEscalatedDeps = AzDeps;

/** Runs one `az repos pr <subcommand> <args>` as the given account's holder identity, through the
 *  same `AzSessionCache` `AzCli`/`EscalatedAzCli` use — not a fresh `az login` per call. Because
 *  the cache keys on `${identity}:${account}` and ADO PR calls always use `identity: 'holder'`, a
 *  PR call against an account whose `EscalatedAzCli` session is already warm reuses that exact
 *  session; there is no separate, ADO-only login path to pay for. This is what turns a repeated
 *  ADO PR call from a ~12s round trip (fresh login every time) into the same near-instant cache hit
 *  `EscalatedAzCli` already gets. */
export async function runAdoEscalated(deps: AzDeps, cache: AzSessionCache, account: string, subcommand: string[], args: string[], cwd: string, signal?: AbortSignal): Promise<RunResult> {
  const session = await cache.getSession(deps, 'holder', account, cwd, signal);
  if ('loginFailed' in session) {
    return session.loginFailed;
  }
  const env = { ...stripAmbientAzureEnv(process.env), AZURE_CONFIG_DIR: session.configDir, AZURE_EXTENSION_DIR: session.extensionDir };
  return await runOnce(deps.executor, 'az', ['repos', 'pr', ...subcommand, ...args], cwd, env, signal);
}
