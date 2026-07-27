import type { AdoPrToolSpec } from './createAdoPrTool';
import { orgArgs } from './orgArgs';
import { AdoPrCreateInputSchema, AdoPrEditInputSchema, AdoPrReadyInputSchema, AdoPrReviewerAddInputSchema, AdoPrReviewerRemoveInputSchema, AdoPrVoteInputSchema } from './schema';

/** Six of the seven named AzureDevOps.PullRequest.* specs (AutoMerge is built directly, not from a
 *  spec — see `createAdoAutoMergeTool`/`createAdoAutoMergeToolV2`) — pure data plus a `buildArgs`
 *  closure, shared verbatim between V1 (`createAdoPrTools`) and V2 (`createAdoPrToolsV2`). */

export const adoPrCreateSpec: AdoPrToolSpec<typeof AdoPrCreateInputSchema> = {
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
};

export const adoPrReadySpec: AdoPrToolSpec<typeof AdoPrReadyInputSchema> = {
  name: 'AzureDevOps_PullRequest_Ready',
  description: 'Publish a draft pull request, taking it out of draft/work-in-progress mode.',
  input_schema: AdoPrReadyInputSchema,
  input_examples: [{ id: 42 }],
  subcommand: ['update'],
  buildArgs: (input, remote) => ['--id', String(input.id), '--draft', 'false', ...orgArgs(input.org, remote)],
};

export const adoPrEditSpec: AdoPrToolSpec<typeof AdoPrEditInputSchema> = {
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
};

export const adoPrReviewerAddSpec: AdoPrToolSpec<typeof AdoPrReviewerAddInputSchema> = {
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
};

export const adoPrReviewerRemoveSpec: AdoPrToolSpec<typeof AdoPrReviewerRemoveInputSchema> = {
  name: 'AzureDevOps_PullRequest_ReviewerRemove',
  description: 'Remove one or more reviewers from a pull request.',
  input_schema: AdoPrReviewerRemoveInputSchema,
  input_examples: [{ id: 42, reviewers: ['jane@example.com'] }],
  subcommand: ['reviewer', 'remove'],
  buildArgs: (input, remote) => ['--id', String(input.id), '--reviewers', ...input.reviewers, ...orgArgs(input.org, remote)],
};

export const adoPrVoteSpec: AdoPrToolSpec<typeof AdoPrVoteInputSchema> = {
  name: 'AzureDevOps_PullRequest_Vote',
  description: "Vote on a pull request. Cannot approve — 'approve' is not a value this tool's vote field can hold.",
  input_schema: AdoPrVoteInputSchema,
  input_examples: [{ id: 42, vote: 'wait-for-author' }],
  subcommand: ['set-vote'],
  buildArgs: (input, remote) => ['--id', String(input.id), '--vote', input.vote, ...orgArgs(input.org, remote)],
};
