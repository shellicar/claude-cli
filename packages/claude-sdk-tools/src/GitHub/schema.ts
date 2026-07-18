import { z } from 'zod';

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
  })
  .strict();

export const GhPrReadyInputSchema = z
  .object({
    number: z.number().int().positive().describe('The pull request number to mark ready for review'),
  })
  .strict();

export const GhPrEditInputSchema = z
  .object({
    number: z.number().int().positive().describe('The pull request number to edit'),
    title: z.string().optional().describe('Set the new title'),
    body: z.string().optional().describe('Set the new body'),
    addLabel: z.array(z.string()).optional().describe('Add labels by name'),
    removeLabel: z.array(z.string()).optional().describe('Remove labels by name'),
  })
  .strict();

export const GhPrCommentInputSchema = z
  .object({
    number: z.number().int().positive().describe('The pull request number to comment on'),
    body: z.string().min(1).describe('The comment body text'),
  })
  .strict();

export const GhPrAutoMergeInputSchema = z
  .object({
    number: z.number().int().positive().describe('The pull request number'),
    enable: z.boolean().describe('true enables auto-merge (--auto), false disables it (--disable-auto). This tool never performs an immediate merge — no merge-strategy flag is ever emitted.'),
  })
  .strict();

export const GhPrReviewInputSchema = z
  .object({
    number: z.number().int().positive().describe('The pull request number to review'),
    type: z.enum(['comment', 'request-changes']).describe("The kind of review to leave. There is no 'approve' option — this tool cannot approve a pull request."),
    body: z.string().min(1).describe('The review body text'),
  })
  .strict();
