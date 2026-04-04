import { z } from 'zod';

const EditFileReplaceOperationSchema = z.object({
  action: z.literal('replace'),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  content: z.string(),
});

const EditFileDeleteOperationSchema = z.object({
  action: z.literal('delete'),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});

const EditFileInsertOperationSchema = z.object({
  action: z.literal('insert'),
  after_line: z.number().int().min(0),
  content: z.string(),
});

export const EditFileOperationSchema = z.discriminatedUnion('action', [EditFileReplaceOperationSchema, EditFileDeleteOperationSchema, EditFileInsertOperationSchema]);

export const EditInputSchema = z.object({
  file: z.string(),
  edits: z.array(EditFileOperationSchema).min(1),
});

export const EditFileOutputSchema = z.object({
  patchId: z.uuid(),
  diff: z.string(),
  file: z.string(),
  newContent: z.string(),
  originalHash: z.string(),
});

export const ConfirmEditFileInputSchema = z.object({
  patchId: z.uuid(),
  file: z.string().describe('Path of the file being edited. Must match the file from the corresponding EditFile call.'),
});

export const ConfirmEditFileOutputSchema = z.object({
  linesAdded: z.number().int().nonnegative(),
  linesRemoved: z.number().int().nonnegative(),
});
