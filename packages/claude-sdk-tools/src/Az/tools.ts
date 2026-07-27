import type { AzSessionCache } from './AzSessionCache';
import { createAzTool } from './createAzTool';
import type { AzDeps } from './runAz';

/** How one identity (reader or holder) on one account authenticates. `cert` is the existing
 *  silent, non-interactive shape (a service principal certificate read fresh from Keychain).
 *  `interactive` runs a real `az login` as the operator's own user — required where Conditional
 *  Access/MFA policy makes a standing app-only credential unworkable, at the cost of needing a
 *  human at the keyboard periodically (see `AzSessionCache`'s persistent session dir for that
 *  case). `subscriptionIds`, if non-empty, skips full subscription discovery entirely and fetches
 *  only those subscriptions via direct API calls, merged into the local cache one login per id —
 *  faster, and (for CA-restricted tenants) the only way to reach a specific subscription without
 *  paying for the full enumeration across every tenant the identity can see. */
export type AzIdentityConfig = { mechanism: 'cert'; clientId: string; subscriptionIds: string[] } | { mechanism: 'interactive'; subscriptionIds: string[] };

/** One entry per account the operator has configured, each identity independently optional and
 *  independently mechanised: an account with no reader identity simply doesn't appear as a valid
 *  `account` for AzCli, one with no holder identity doesn't for EscalatedAzCli — checked live per
 *  call (see `resolveAzAccount`), not baked into either tool's schema. Reader and holder can use
 *  different mechanisms on the same account (e.g. cert for reader, interactive for holder). */
export type AzAccountsConfig = Record<string, { tenantId: string; reader: AzIdentityConfig | null; holder: AzIdentityConfig | null }>;

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
 *  the matching identity configured.
 *
 *  `cache` is constructed by the caller, not here, and shared with `AzureDevOps.PullRequest.*` (see
 *  `AzureDevOps/tools.ts`'s `createAdoPrTools`) — one `AzSessionCache` for every escalated `az`
 *  surface in the process, so a login warmed by one tool is reused by the others rather than each
 *  keeping its own. It is still a process-lifetime singleton in practice: the caller
 *  (`createAppTools`, invoked once — see its own docs) constructs it exactly once and passes the
 *  same instance to every consumer. */
export function createAzTools(deps: AzDeps, getAccounts: () => AzAccountsConfig, cache: AzSessionCache) {
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
