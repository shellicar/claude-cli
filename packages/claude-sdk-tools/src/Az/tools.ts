import type { Clock } from '@js-joda/core';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { AzSessionCache } from './AzSessionCache';
import { createAzTool } from './createAzTool';
import type { AzDeps } from './runAz';
import { createAzInputSchema } from './schema';

/** One entry per account the operator has configured, each independently optional per identity:
 *  an account with no reader service principal simply doesn't appear in AzCli's enum, one with no
 *  holder doesn't appear in EscalatedAzCli's. */
export type AzAccountsConfig = Record<string, { tenantId: string; readerClientId: string | null; holderClientId: string | null }>;

function isNonEmpty(names: string[]): names is [string, ...string[]] {
  return names.length > 0;
}

/** AzCli and EscalatedAzCli are the same shape, differing only in which identity (and so which
 *  RBAC role) they run under and which permission bucket they sit in. Unlike GitHub/AzureDevOps,
 *  `az` has no single bounded surface to enumerate into named per-verb tools, so the credential
 *  itself is the enforcement point: each account gets its own reader/holder service principal,
 *  scoped by RBAC, and the tool stays a free-text proposer. Neither tool is registered at all if
 *  no account has that identity configured. */
export function createAzTools(deps: AzDeps, accounts: AzAccountsConfig, clock: Clock, logger?: ILogger) {
  const readerAccounts = Object.entries(accounts)
    .filter(([, a]) => a.readerClientId != null)
    .map(([name]) => name);
  const holderAccounts = Object.entries(accounts)
    .filter(([, a]) => a.holderClientId != null)
    .map(([name]) => name);

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
  const tools = [];

  if (isNonEmpty(readerAccounts)) {
    tools.push(
      createAzTool(
        {
          name: 'AzCli',
          operation: 'write',
          description: 'Run an Azure CLI (`az`) command under the unprivileged reader identity of a configured account.',
          input_schema: createAzInputSchema(readerAccounts),
          identity: 'reader',
          defaultAccount: readerAccounts.length === 1 ? readerAccounts[0] : undefined,
        },
        deps,
        cache,
      ),
    );
  }

  if (isNonEmpty(holderAccounts)) {
    tools.push(
      createAzTool(
        {
          name: 'EscalatedAzCli',
          operation: 'escalate',
          description: 'Run an Azure CLI (`az`) command under the privileged holder identity of a configured account. Always asks for approval first.',
          input_schema: createAzInputSchema(holderAccounts),
          identity: 'holder',
          defaultAccount: holderAccounts.length === 1 ? holderAccounts[0] : undefined,
        },
        deps,
        cache,
      ),
    );
  }

  return tools;
}
