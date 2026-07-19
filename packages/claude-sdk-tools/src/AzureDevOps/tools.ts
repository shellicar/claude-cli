import { createAdoAutoMergeTool } from './createAdoAutoMergeTool';
import { type AdoEscalatedDeps, createAdoPrTool } from './createAdoPrTool';
import type { AdoRemoteContext } from './parseAdoRemote';
import { AdoPrCreateInputSchema, AdoPrEditInputSchema, AdoPrReadyInputSchema, AdoPrReviewerAddInputSchema, AdoPrReviewerRemoveInputSchema, AdoPrVoteInputSchema } from './schema';

/** Resolution order for `--org`: the model's explicit `org` input wins; otherwise the org parsed
 *  from the target repo's own git remote (see parseAdoRemote). No config-level default — between
 *  remote parsing and the explicit input field, there is always a way to supply it, so a third,
 *  harder-to-discover fallback layer only adds a place for the wrong org to hide. Omitted entirely
 *  when neither source has one, so `az`'s own error names what's actually missing. */
export function orgArgs(org: string | undefined, remote: AdoRemoteContext | null): string[] {
  const resolved = org ?? remote?.orgUrl;
  return resolved != null ? ['--org', resolved] : [];
}

/** The named, typed AzureDevOps.PullRequest.* tools. Each hardcodes which `az repos pr` subcommand
 *  and flags it ever emits — the same structural guarantee the GitHub.PullRequest.* tools give (see
 *  the GitHub package), applied to Azure DevOps instead of GitHub. There is no comment tool: az cli
 *  has no `az repos pr comment` subcommand (thread comments require a raw REST call via `az devops
 *  invoke`, which cannot carry a fixed-subcommand guarantee), so it is left out rather than faked. */
export function createAdoPrTools(deps: AdoEscalatedDeps) {
  const Create = createAdoPrTool(
    {
      name: 'AzureDevOps_PullRequest_Create',
      description: 'Open a new pull request as a draft. Always passes --draft — AzureDevOps_PullRequest_Ready is the separate step that promotes it out of draft.',
      input_schema: AdoPrCreateInputSchema,
      input_examples: [{ title: 'Fix the flaky retry test', sourceBranch: 'fix/flaky-retry', description: 'Retries now back off exponentially.' }],
      subcommand: ['create'],
      buildArgs: (input, remote) => {
        const args = ['--title', input.title, '--source-branch', input.sourceBranch, ...orgArgs(input.org, remote)];
        if (input.description != null) {
          args.push('--description', input.description);
        }
        if (input.targetBranch != null) {
          args.push('--target-branch', input.targetBranch);
        }
        args.push('--draft', 'true');
        // project/repository: explicit input wins, then the git remote's own project/repository
        // (parsed alongside org — `az`'s own `--detect` never resolves project, only organization,
        // so this is the only reliable source besides the model naming them directly), otherwise
        // omitted entirely so az's own error names what's actually missing.
        const project = input.project ?? remote?.project;
        if (project != null) {
          args.push('--project', project);
        }
        const repository = input.repository ?? remote?.repository;
        if (repository != null) {
          args.push('--repository', repository);
        }
        if (input.reviewers != null && input.reviewers.length > 0) {
          args.push('--reviewers', ...input.reviewers);
        }
        if (input.requiredReviewers != null && input.requiredReviewers.length > 0) {
          args.push('--required-reviewers', ...input.requiredReviewers);
        }
        if (input.workItems != null && input.workItems.length > 0) {
          args.push('--work-items', ...input.workItems);
        }
        if (input.labels != null && input.labels.length > 0) {
          args.push('--labels', ...input.labels);
        }
        return args;
      },
    },
    deps,
  );

  const Ready = createAdoPrTool(
    {
      name: 'AzureDevOps_PullRequest_Ready',
      description: 'Publish a draft pull request, taking it out of draft/work-in-progress mode.',
      input_schema: AdoPrReadyInputSchema,
      input_examples: [{ id: 42 }],
      subcommand: ['update'],
      buildArgs: (input, remote) => ['--id', String(input.id), '--draft', 'false', ...orgArgs(input.org, remote)],
    },
    deps,
  );

  const Edit = createAdoPrTool(
    {
      name: 'AzureDevOps_PullRequest_Edit',
      description: 'Edit an existing pull request: title, description, or abandon it. Cannot complete (merge) a pull request — that status value is not accepted; use AzureDevOps_PullRequest_AutoMerge instead.',
      input_schema: AdoPrEditInputSchema,
      input_examples: [{ id: 42, title: 'Updated title' }],
      subcommand: ['update'],
      buildArgs: (input, remote) => {
        const args = ['--id', String(input.id), ...orgArgs(input.org, remote)];
        if (input.title != null) {
          args.push('--title', input.title);
        }
        if (input.description != null) {
          args.push('--description', input.description);
        }
        if (input.status != null) {
          args.push('--status', input.status);
        }
        return args;
      },
    },
    deps,
  );

  const AutoMerge = createAdoAutoMergeTool(deps);

  const ReviewerAdd = createAdoPrTool(
    {
      name: 'AzureDevOps_PullRequest_ReviewerAdd',
      description: 'Add one or more reviewers to a pull request.',
      input_schema: AdoPrReviewerAddInputSchema,
      input_examples: [{ id: 42, reviewers: ['jane@example.com'] }],
      subcommand: ['reviewer', 'add'],
      buildArgs: (input, remote) => {
        const args = ['--id', String(input.id), '--reviewers', ...input.reviewers, ...orgArgs(input.org, remote)];
        if (input.required != null) {
          args.push('--required', String(input.required));
        }
        return args;
      },
    },
    deps,
  );

  const ReviewerRemove = createAdoPrTool(
    {
      name: 'AzureDevOps_PullRequest_ReviewerRemove',
      description: 'Remove one or more reviewers from a pull request.',
      input_schema: AdoPrReviewerRemoveInputSchema,
      input_examples: [{ id: 42, reviewers: ['jane@example.com'] }],
      subcommand: ['reviewer', 'remove'],
      buildArgs: (input, remote) => ['--id', String(input.id), '--reviewers', ...input.reviewers, ...orgArgs(input.org, remote)],
    },
    deps,
  );

  const Vote = createAdoPrTool(
    {
      name: 'AzureDevOps_PullRequest_Vote',
      description: "Vote on a pull request. Cannot approve — 'approve' is not a value this tool's vote field can hold.",
      input_schema: AdoPrVoteInputSchema,
      input_examples: [{ id: 42, vote: 'wait-for-author' }],
      subcommand: ['set-vote'],
      buildArgs: (input, remote) => ['--id', String(input.id), '--vote', input.vote, ...orgArgs(input.org, remote)],
    },
    deps,
  );

  return [Create, Ready, Edit, AutoMerge, ReviewerAdd, ReviewerRemove, Vote] as const;
}
