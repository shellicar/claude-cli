import { z } from 'zod';

const ReplaceOperationSchema = z.object({
  action: z.literal('replace'),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  content: z.string(),
});

const DeleteOperationSchema = z.object({
  action: z.literal('delete'),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});

const InsertOperationSchema = z.object({
  action: z.literal('insert'),
  after_line: z.number().int().min(0),
  content: z.string(),
});

export const EditOperationSchema = z.discriminatedUnion('action', [ReplaceOperationSchema, DeleteOperationSchema, InsertOperationSchema]);

export const EditInputSchema = z.object({
  file: z.string(),
  edits: z.array(EditOperationSchema).min(1),
});

export const EditOutputSchema = z.object({
  patchId: z.string(),
  diff: z.string(),
  file: z.string(),
  newContent: z.string(),
  originalHash: z.string(),
});

export const EditConfirmInputSchema = z.object({
  patchId: z.string(),
});

export const EditConfirmOutputSchema = z.object({
  linesChanged: z.number().int().nonnegative(),
});
