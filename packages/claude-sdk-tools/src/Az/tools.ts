import type { Clock } from '@js-joda/core';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { AzSessionCache } from './AzSessionCache';
import { createAzTool } from './createAzTool';
import type { AzDeps } from './runAz';

/** One entry per account the operator has configured, each independently optional per identity:
 *  an account with no reader service principal simply doesn't appear as a valid `account` for
 *  AzCli, one with no holder doesn't for EscalatedAzCli — checked live per call (see
 *  `resolveAzAccount`), not baked into either tool's schema. */
export type AzAccountsConfig = Record<string, { tenantId: string; readerClientId: string | null; holderClientId: string | null }>;

export const AZ_CLI_TOOL_NAME = 'AzCli';
export const ESCALATED_AZ_CLI_TOOL_NAME = 'EscalatedAzCli';

/** AzCli and EscalatedAzCli are the same shape, differing only in which identity (and so which
 *  RBAC role) they run under and which permission bucket they sit in. Unlike GitHub/AzureDevOps,
 *  `az` has no single bounded surface to enumerate into named per-verb tools, so the credential
 *  itself is the enforcement point: each account gets its own reader/holder service principal,
 *  scoped by RBAC, and the tool stays a free-text proposer.
 *
 *  Both tools are always registered, unconditionally — whether either identity currently has any
 *  account configured is live config, and can change on a reload; gating registration here would
 *  freeze that decision at process start. Instead, `getAccounts` is read fresh on every call (see
 *  `resolveAzAccount`), and whether the tool is even offered to the model on a given turn is decided
 *  live too, by the disabled-tools provider (see `ConfigDisabledToolsProvider` in the CLI app),
 *  which hides `AzCli`/`EscalatedAzCli` from that turn's tool list whenever no account currently has
 *  the matching identity configured. */
export function createAzTools(deps: AzDeps, getAccounts: () => AzAccountsConfig, clock: Clock, logger?: ILogger) {
  // One cache shared by every Az tool this call builds, so a reader and holder call against the
  // same account in one block still share nothing (different identities → different cache keys),
  // but repeated calls under the same identity/account do.
  //
  // This is a real process-lifetime singleton, not just per-call: `createAzTools` is only ever
  // invoked once, inside the DI container's `AppToolsService` factory registration
  // (apps/claude-sdk-cli/src/setup/container.ts) — `core-di-lite` memoizes a factory registration by
  // the registration itself, so `AppToolsService.resolve()` constructs it once and every later
  // resolve returns the same cached instance for the container's (i.e. the process's) lifetime. If
  // that factory wiring ever changes to construct `AppToolsService` more than once, this cache stops
  // being a singleton and the "process lifetime" claim above breaks silently.
  const cache = new AzSessionCache(clock, logger);

  return [
    createAzTool(
      {
        name: AZ_CLI_TOOL_NAME,
        operation: 'write',
        description: 'Run an Azure CLI (`az`) command under the unprivileged reader identity of a configured account.',
        identity: 'reader',
      },
      deps,
      cache,
      getAccounts,
    ),
    createAzTool(
      {
        name: ESCALATED_AZ_CLI_TOOL_NAME,
        operation: 'escalate',
        description: 'Run an Azure CLI (`az`) command under the privileged holder identity of a configured account. Always asks for approval first.',
        identity: 'holder',
      },
      deps,
      cache,
      getAccounts,
    ),
  ];
}
