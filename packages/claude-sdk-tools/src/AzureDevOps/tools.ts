import type { AzSessionCache } from '../Az/AzSessionCache';
import type { AzAccountsConfig } from '../Az/tools';
import { createAdoAutoMergeTool } from './createAdoAutoMergeTool';
import { type AdoEscalatedDeps, createAdoPrTool } from './createAdoPrTool';
import { orgArgs } from './orgArgs';
import { adoPrCreateSpec, adoPrEditSpec, adoPrReadySpec, adoPrReviewerAddSpec, adoPrReviewerRemoveSpec, adoPrVoteSpec } from './specs';

export { orgArgs };

export const ADO_PR_TOOL_NAMES = ['AzureDevOps_PullRequest_Create', 'AzureDevOps_PullRequest_Ready', 'AzureDevOps_PullRequest_Edit', 'AzureDevOps_PullRequest_AutoMerge', 'AzureDevOps_PullRequest_ReviewerAdd', 'AzureDevOps_PullRequest_ReviewerRemove', 'AzureDevOps_PullRequest_Vote'] as const;

/** The named, typed AzureDevOps.PullRequest.* tools. Each hardcodes which `az repos pr` subcommand
 *  and flags it ever emits — the same structural guarantee the GitHub.PullRequest.* tools give (see
 *  the GitHub package), applied to Azure DevOps instead of GitHub. There is no comment tool: az cli
 *  has no `az repos pr comment` subcommand (thread comments require a raw REST call via `az devops
 *  invoke`, which cannot carry a fixed-subcommand guarantee), so it is left out rather than faked.
 *
 *  Always registered, unconditionally — whether any account currently has a holder identity
 *  configured is live config and can change on a reload; gating registration here would freeze
 *  that decision at process start (see `Az/tools.ts`'s `createAzTools` for the same reasoning).
 *  `getAccounts` is read fresh on every call (see `resolveAzAccount`), and whether these tools are
 *  even offered to the model on a given turn is decided live too, by the disabled-tools provider
 *  (see `ConfigDisabledToolsProvider` in the CLI app), which hides every name in `ADO_PR_TOOL_NAMES`
 *  whenever no account currently has a holder identity configured.
 *
 *  `cache` is the same `AzSessionCache` `AzCli`/`EscalatedAzCli` are built with — the caller
 *  constructs it once and passes the same instance to both `createAzTools` and this function, so a
 *  PR call and an `EscalatedAzCli` call against the same account share one warm login instead of
 *  each keeping its own. */
export function createAdoPrTools(deps: AdoEscalatedDeps, getAccounts: () => AzAccountsConfig, cache: AzSessionCache) {
  return [
    createAdoPrTool(adoPrCreateSpec, deps, getAccounts, cache),
    createAdoPrTool(adoPrReadySpec, deps, getAccounts, cache),
    createAdoPrTool(adoPrEditSpec, deps, getAccounts, cache),
    createAdoAutoMergeTool(deps, getAccounts, cache),
    createAdoPrTool(adoPrReviewerAddSpec, deps, getAccounts, cache),
    createAdoPrTool(adoPrReviewerRemoveSpec, deps, getAccounts, cache),
    createAdoPrTool(adoPrVoteSpec, deps, getAccounts, cache),
  ] as const;
}
