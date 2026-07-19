import { pathSchema } from '@shellicar/claude-sdk';
import { z } from 'zod';

const cwdSchema = pathSchema.optional().describe("Directory to run `gh` in. Supports ~ and $VAR expansion. Determines which repo the command targets (via its git remote) — required whenever the CLI's own working directory is not the target repo. Defaults to the CLI's own working directory when omitted.");

export const GhPrOutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
});

export const GhPrCreateInputSchema = z
  .object({
    title: z.string().min(1).describe('Title for the pull request'),
    body: z.string().describe('Body for the pull request'),
    base: z.string().min(1).describe('The branch into which the code should be merged'),
    head: z.string().optional().describe('The branch that contains commits for the pull request (defaults to the current branch)'),
    milestone: z.string().optional().describe('Add the pull request to a milestone by name'),
    reviewer: z.array(z.string()).optional().describe('Request reviews from people or teams by their handle'),
    assignee: z.array(z.string()).optional().describe('Assign people by their login. Use "@me" to self-assign.'),
    label: z.array(z.string()).optional().describe('Add labels by name'),
    cwd: cwdSchema,
  })
  .strict();

export const GhPrReadyInputSchema = z
  .object({
    number: z.number().int().positive().describe('The pull request number to mark ready for review'),
    cwd: cwdSchema,
  })
  .strict();

export const GhPrEditInputSchema = z
  .object({
    number: z.number().int().positive().describe('The pull request number to edit'),
    title: z.string().optional().describe('Set the new title'),
    body: z.string().optional().describe('Set the new body'),
    addLabel: z.array(z.string()).optional().describe('Add labels by name'),
    removeLabel: z.array(z.string()).optional().describe('Remove labels by name'),
    addAssignee: z.array(z.string()).optional().describe('Add assigned users by their login. Use "@me" to assign yourself.'),
    removeAssignee: z.array(z.string()).optional().describe('Remove assigned users by their login. Use "@me" to unassign yourself.'),
    addReviewer: z.array(z.string()).optional().describe('Add or re-request reviewers by their login'),
    removeReviewer: z.array(z.string()).optional().describe('Remove reviewers by their login'),
    milestone: z.string().optional().describe('Set the milestone the pull request belongs to by name'),
    removeMilestone: z.boolean().optional().describe('Remove the milestone association from the pull request'),
    cwd: cwdSchema,
  })
  .strict();

export const GhPrCommentInputSchema = z
  .object({
    number: z.number().int().positive().describe('The pull request number to comment on'),
    body: z.string().min(1).describe('The comment body text'),
    cwd: cwdSchema,
  })
  .strict();

export const GhPrAutoMergeInputSchema = z
  .object({
    number: z.number().int().positive().describe('The pull request number'),
    enable: z.boolean().describe('true enables auto-merge (--auto), false disables it (--disable-auto). This tool never performs an immediate merge.'),
    strategy: z.enum(['merge', 'squash', 'rebase']).optional().describe('Merge strategy flag (--merge, --squash, --rebase) to pass alongside --auto. Required when enable is true; ignored when disabling.'),
    cwd: cwdSchema,
  })
  .strict()
  .refine((input) => !input.enable || input.strategy != null, {
    message: 'strategy is required when enable is true',
    path: ['strategy'],
  });

export const GhPrReviewInputSchema = z
  .object({
    number: z.number().int().positive().describe('The pull request number to review'),
    type: z.enum(['comment', 'request-changes']).describe("The kind of review to leave. There is no 'approve' option — this tool cannot approve a pull request."),
    body: z.string().min(1).describe('The review body text'),
    cwd: cwdSchema,
  })
  .strict();
