import { pathSchema } from '@shellicar/claude-sdk';
import { z } from 'zod';

const cwdSchema = pathSchema
  .optional()
  .describe("Directory to run `az` in. Supports ~ and $VAR expansion. Determines which repo the command targets (via its git remote) when org/project/repository are omitted — required whenever the CLI's own working directory is not the target repo. Defaults to the CLI's own working directory when omitted.");

export const AdoPrOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
});

export const AdoPrCreateInputSchema = z
  .object({
    title: z.string().min(1).describe('Title for the new pull request'),
    description: z.string().optional().describe('Description for the new pull request. Can include markdown'),
    sourceBranch: z.string().min(1).describe('Name of the source branch, e.g. "dev"'),
    targetBranch: z.string().optional().describe('Name of the target branch. Defaults to the default branch of the target repository'),
    reviewers: z.array(z.string()).optional().describe('Additional users or groups to include as optional reviewers'),
    requiredReviewers: z.array(z.string()).optional().describe('Additional users or groups to include as required reviewers'),
    workItems: z.array(z.string()).optional().describe('IDs of work items to link to the new pull request'),
    labels: z.array(z.string()).optional().describe('Labels to associate with the pull request'),
    org: z.string().optional().describe('Azure DevOps organization URL, e.g. https://dev.azure.com/MyOrg/. Falls back to git config / az devops defaults if omitted'),
    project: z.string().optional().describe('Name or ID of the project. Falls back to git config / az devops defaults if omitted'),
    repository: z.string().optional().describe('Name or ID of the repository to create the pull request in'),
    cwd: cwdSchema,
  })
  .strict();

export const AdoPrReadyInputSchema = z
  .object({
    id: z.number().int().positive().describe('ID of the pull request to publish out of draft'),
    org: z.string().optional().describe('Azure DevOps organization URL'),
    cwd: cwdSchema,
  })
  .strict();

export const AdoPrEditInputSchema = z
  .object({
    id: z.number().int().positive().describe('ID of the pull request to edit'),
    title: z.string().optional().describe('New title for the pull request'),
    description: z.string().optional().describe('New description for the pull request. Can include markdown'),
    status: z.enum(['active', 'abandoned']).optional().describe("New state of the pull request. There is no 'completed' option — this tool cannot merge a pull request; use AzureDevOps_PullRequest_AutoMerge to queue a merge"),
    org: z.string().optional().describe('Azure DevOps organization URL'),
    cwd: cwdSchema,
  })
  .strict();

export const AdoPrAutoMergeInputSchema = z
  .object({
    id: z.number().int().positive().describe('ID of the pull request'),
    enable: z.boolean().describe('true enables auto-complete (--auto-complete true), false disables it. This tool never performs an immediate merge'),
    squash: z.boolean().optional().describe('Squash the commits in the source branch when merging into the target branch'),
    deleteSourceBranch: z.boolean().optional().describe('Delete the source branch after the pull request completes'),
    org: z.string().optional().describe('Azure DevOps organization URL'),
    cwd: cwdSchema,
  })
  .strict();

export const AdoPrReviewerAddInputSchema = z
  .object({
    id: z.number().int().positive().describe('ID of the pull request'),
    reviewers: z.array(z.string()).min(1).describe('Users or groups to include as reviewers, space separated'),
    required: z.boolean().optional().describe('Make the added reviewers required'),
    org: z.string().optional().describe('Azure DevOps organization URL'),
    cwd: cwdSchema,
  })
  .strict();

export const AdoPrReviewerRemoveInputSchema = z
  .object({
    id: z.number().int().positive().describe('ID of the pull request'),
    reviewers: z.array(z.string()).min(1).describe('Users or groups to remove as reviewers'),
    org: z.string().optional().describe('Azure DevOps organization URL'),
    cwd: cwdSchema,
  })
  .strict();

export const AdoPrVoteInputSchema = z
  .object({
    id: z.number().int().positive().describe('ID of the pull request to vote on'),
    vote: z.enum(['approve-with-suggestions', 'reject', 'reset', 'wait-for-author']).describe("New vote value for the pull request. There is no 'approve' option — this tool cannot approve a pull request"),
    org: z.string().optional().describe('Azure DevOps organization URL'),
    cwd: cwdSchema,
  })
  .strict();
