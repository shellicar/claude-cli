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
export function createAzTools(deps: AzDeps, accounts: AzAccountsConfig) {
  const readerAccounts = Object.entries(accounts)
    .filter(([, a]) => a.readerClientId != null)
    .map(([name]) => name);
  const holderAccounts = Object.entries(accounts)
    .filter(([, a]) => a.holderClientId != null)
    .map(([name]) => name);

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
      ),
    );
  }

  return tools;
}
