import { defineTool } from '@shellicar/claude-sdk';
import type { AzSessionCache } from '../Az/AzSessionCache';
import { resolveAzAccount } from '../Az/createAzTool';
import type { AzAccountsConfig } from '../Az/tools';
import { getGitRemoteUrl } from './gitRemote';
import { orgNameFromRemote, parseAdoRemote } from './parseAdoRemote';
import type { AdoEscalatedDeps } from './runAdoEscalated';
import { runAdoEscalated } from './runAdoEscalated';
import { AdoPrAutoMergeInputSchema, AdoPrOutputSchema } from './schema';

/** Builds the same merge commit message Azure DevOps' own web UI generates on completion:
 *  `Merged PR {id}: {title}\n\n{description}`. This is fixed and derived entirely from the PR's own
 *  fields — never a free-text field the agent fills in. A caller-supplied message would let the
 *  agent write history into the merge commit instead of the PR's own record; matches the format the
 *  azure-devops-repos skill's pr-merge-message.sh already establishes as the expected one. */
export function buildMergeCommitMessage(id: number, title: string, description: string): string {
  return `Merged PR ${id}: ${title}\n\n${description}`;
}

/** AzureDevOps_PullRequest_AutoMerge: enable/disable auto-complete. Unlike the other named tools,
 *  enabling requires two `az repos pr` calls — a `show` to read the PR's own title/description, then
 *  an `update` carrying the merge commit message built from them — so it does not fit the single
 *  fixed-subcommand `createAdoPrTool` shape and is built directly.
 *
 *  `getAccounts` is read fresh on every call (see `resolveAzAccount`), never a list captured once at
 *  tool-build time — the same live-config shape every other AzureDevOps.PullRequest.* tool uses.
 *  `cache` is the same `AzSessionCache` instance `AzCli`/`EscalatedAzCli` share (see
 *  `runAdoEscalated`), so both `az repos pr` calls this tool can make reuse an already-warm holder
 *  session instead of each paying its own fresh login. */
export function createAdoAutoMergeTool(deps: AdoEscalatedDeps, getAccounts: () => AzAccountsConfig, cache: AzSessionCache) {
  return defineTool({
    name: 'AzureDevOps_PullRequest_AutoMerge',
    operation: 'escalate',
    description:
      "Enable or disable auto-complete on a pull request. Never performs an immediate merge — only queues one via --auto-complete true, or clears it via --auto-complete false. The merge commit message is generated from the pull request's own title and description, matching what the Azure DevOps web UI would produce; it cannot be set by the caller.",
    input_schema: AdoPrAutoMergeInputSchema,
    output_schema: AdoPrOutputSchema,
    input_examples: [{ id: 42, enable: true, squash: true }],
    handler: async (input, signal) => {
      const cwd = input.cwd ?? process.cwd();
      const remoteUrl = await getGitRemoteUrl(cwd);
      const remote = remoteUrl != null ? parseAdoRemote(remoteUrl) : null;
      const account = resolveAzAccount(getAccounts, 'holder', input.account, orgNameFromRemote(remote));
      const resolvedOrg = input.org ?? remote?.orgUrl;
      const orgArgs = resolvedOrg != null ? ['--org', resolvedOrg] : [];

      if (!input.enable) {
        const result = await runAdoEscalated(deps, cache, account, ['update'], ['--id', String(input.id), '--auto-complete', 'false', ...orgArgs], cwd, signal);
        return { textContent: { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: result.exitCode } };
      }

      const show = await runAdoEscalated(deps, cache, account, ['show'], ['--id', String(input.id), '--query', '{title:title,description:description}', '-o', 'json', ...orgArgs], cwd, signal);
      if (show.exitCode !== 0) {
        return { textContent: { stdout: show.stdout.trim(), stderr: show.stderr.trim(), exitCode: show.exitCode } };
      }
      const pr = JSON.parse(show.stdout) as { title: string; description?: string };
      const message = buildMergeCommitMessage(input.id, pr.title, pr.description ?? '');

      const args = ['--id', String(input.id), '--auto-complete', 'true', '--merge-commit-message', message, ...orgArgs];
      if (input.squash != null) {
        args.push('--squash', String(input.squash));
      }
      if (input.deleteSourceBranch != null) {
        args.push('--delete-source-branch', String(input.deleteSourceBranch));
      }
      const result = await runAdoEscalated(deps, cache, account, ['update'], args, cwd, signal);
      return { textContent: { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: result.exitCode } };
    },
  });
}
