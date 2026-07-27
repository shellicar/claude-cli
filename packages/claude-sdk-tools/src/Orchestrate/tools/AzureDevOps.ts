import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import type { z } from 'zod';
import type { AzSessionCache } from '../../Az/AzSessionCache.js';
import { resolveAzAccount } from '../../Az/createAzTool.js';
import type { AzAccountsConfig } from '../../Az/tools.js';
import { buildMergeCommitMessage } from '../../AzureDevOps/createAdoAutoMergeTool.js';
import type { AdoPrToolSpec } from '../../AzureDevOps/createAdoPrTool.js';
import { getGitRemoteUrl } from '../../AzureDevOps/gitRemote.js';
import { orgArgs } from '../../AzureDevOps/orgArgs.js';
import { orgNameFromRemote, parseAdoRemote } from '../../AzureDevOps/parseAdoRemote.js';
import type { AdoEscalatedDeps } from '../../AzureDevOps/runAdoEscalated.js';
import { runAdoEscalated } from '../../AzureDevOps/runAdoEscalated.js';
import { AdoPrAutoMergeInputSchema } from '../../AzureDevOps/schema.js';
import { adoPrCreateSpec, adoPrEditSpec, adoPrReadySpec, adoPrReviewerAddSpec, adoPrReviewerRemoveSpec, adoPrVoteSpec } from '../../AzureDevOps/specs.js';
import { defineToolV2 } from '../defineToolV2.js';

/** One named AzureDevOps.PullRequest.* V2 tool from an `AdoPrToolSpec` — same spec, same
 *  `runAdoEscalated`/`resolveAzAccount`/remote-parsing V1's `createAdoPrTool` uses, so the arg
 *  building and account/remote resolution are identical between V1 and V2. `escalate`: see
 *  `GitHub.ts`'s equivalent for the reasoning. */
function createAdoPrToolV2<TSchema extends z.ZodType<{ account?: string; cwd?: string }>>(spec: AdoPrToolSpec<TSchema>, deps: AdoEscalatedDeps, getAccounts: () => AzAccountsConfig, cache: AzSessionCache) {
  return defineToolV2({
    name: spec.name,
    description: spec.description,
    operation: 'escalate',
    model: spec.input_schema,
    run: (input, _upstream, stderr): ToolV2Result<string> => {
      let ok = true;

      async function* run(): Stream<string> {
        const cwd = input.cwd ?? process.cwd();
        const remoteUrl = await getGitRemoteUrl(cwd);
        const remote = remoteUrl != null ? parseAdoRemote(remoteUrl) : null;
        const account = resolveAzAccount(getAccounts, 'holder', input.account, orgNameFromRemote(remote));
        const result = await runAdoEscalated(deps, cache, account, spec.subcommand, spec.buildArgs(input, remote), cwd);
        ok = result.exitCode === 0;
        const stdout = result.stdout.trim();
        if (stdout.length > 0) {
          yield* stdout.split('\n');
        }
        const stderrText = result.stderr.trim();
        if (stderrText.length > 0) {
          stderr.push(...stderrText.split('\n'));
        }
      }

      return { stdout: run(), success: () => ok };
    },
  });
}

/** AzureDevOps_PullRequest_AutoMerge V2 — same two-call (show, then update) shape as V1's
 *  `createAdoAutoMergeTool`, reusing its `buildMergeCommitMessage` verbatim so the merge commit
 *  message stays byte-identical between V1 and V2. */
function createAdoAutoMergeToolV2(deps: AdoEscalatedDeps, getAccounts: () => AzAccountsConfig, cache: AzSessionCache) {
  return defineToolV2({
    name: 'AzureDevOps_PullRequest_AutoMerge',
    description:
      "Enable or disable auto-complete on a pull request. Never performs an immediate merge — only queues one via --auto-complete true, or clears it via --auto-complete false. The merge commit message is generated from the pull request's own title and description, matching what the Azure DevOps web UI would produce; it cannot be set by the caller.",
    operation: 'escalate',
    model: AdoPrAutoMergeInputSchema,
    run: (input, _upstream, stderr): ToolV2Result<string> => {
      let ok = true;

      async function* run(): Stream<string> {
        const cwd = input.cwd ?? process.cwd();
        const remoteUrl = await getGitRemoteUrl(cwd);
        const remote = remoteUrl != null ? parseAdoRemote(remoteUrl) : null;
        const account = resolveAzAccount(getAccounts, 'holder', input.account, orgNameFromRemote(remote));
        const orgArgsResolved = orgArgs(input.org, remote);

        if (!input.enable) {
          const result = await runAdoEscalated(deps, cache, account, ['update'], ['--id', String(input.id), '--auto-complete', 'false', ...orgArgsResolved], cwd);
          ok = result.exitCode === 0;
          const stdout = result.stdout.trim();
          if (stdout.length > 0) {
            yield* stdout.split('\n');
          }
          const stderrText = result.stderr.trim();
          if (stderrText.length > 0) {
            stderr.push(...stderrText.split('\n'));
          }
          return;
        }

        const show = await runAdoEscalated(deps, cache, account, ['show'], ['--id', String(input.id), '--query', '{title:title,description:description}', '-o', 'json', ...orgArgsResolved], cwd);
        if (show.exitCode !== 0) {
          ok = false;
          const stdout = show.stdout.trim();
          if (stdout.length > 0) {
            yield* stdout.split('\n');
          }
          const stderrText = show.stderr.trim();
          if (stderrText.length > 0) {
            stderr.push(...stderrText.split('\n'));
          }
          return;
        }
        const pr = JSON.parse(show.stdout) as { title: string; description?: string };
        const message = buildMergeCommitMessage(input.id, pr.title, pr.description ?? '');

        const args = ['--id', String(input.id), '--auto-complete', 'true', '--merge-commit-message', message, ...orgArgsResolved];
        if (input.squash != null) {
          args.push('--squash', String(input.squash));
        }
        if (input.deleteSourceBranch != null) {
          args.push('--delete-source-branch', String(input.deleteSourceBranch));
        }
        const result = await runAdoEscalated(deps, cache, account, ['update'], args, cwd);
        ok = result.exitCode === 0;
        const stdout = result.stdout.trim();
        if (stdout.length > 0) {
          yield* stdout.split('\n');
        }
        const stderrText = result.stderr.trim();
        if (stderrText.length > 0) {
          stderr.push(...stderrText.split('\n'));
        }
      }

      return { stdout: run(), success: () => ok };
    },
  });
}

/** The seven named AzureDevOps.PullRequest.* V2 tools, sharing `deps`/`cache` with V1's
 *  `createAdoPrTools` — the same `AzSessionCache` instance, so a warm holder session is reused
 *  across V1 and V2 calls alike, and with `AzCli`/`EscalatedAzCli` V2 (see `Az.ts`). */
export function createAdoPrToolsV2(deps: AdoEscalatedDeps, getAccounts: () => AzAccountsConfig, cache: AzSessionCache) {
  return [
    createAdoPrToolV2(adoPrCreateSpec, deps, getAccounts, cache),
    createAdoPrToolV2(adoPrReadySpec, deps, getAccounts, cache),
    createAdoPrToolV2(adoPrEditSpec, deps, getAccounts, cache),
    createAdoAutoMergeToolV2(deps, getAccounts, cache),
    createAdoPrToolV2(adoPrReviewerAddSpec, deps, getAccounts, cache),
    createAdoPrToolV2(adoPrReviewerRemoveSpec, deps, getAccounts, cache),
    createAdoPrToolV2(adoPrVoteSpec, deps, getAccounts, cache),
  ] as const;
}
