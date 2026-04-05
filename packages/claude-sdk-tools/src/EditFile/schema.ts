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

const EditFileReplaceStringOperationSchema = z.object({
  action: z.literal('replace_text'),
  oldString: z.string().min(1).describe('String to search for'),
  replacement: z.string().describe('Replacement string.'),
  replaceMultiple: z.boolean().optional().default(false).describe('If true, replace all matches. If false (default), error if more than one match is found.'),
});

const EditFileReplaceRegexOperationSchema = z.object({
  action: z.literal('regex_text'),
  pattern: z.string().min(1).describe('Regex pattern to search for'),
  replacement: z.string().describe('Replacement string. Supports capture groups ($1, $2), $& (matched text), $$ (literal $).'),
  replaceMultiple: z.boolean().optional().default(false).describe('If true, replace all matches. If false (default), error if more than one match is found.'),
});

export const EditFileResolvedOperationSchema = z.discriminatedUnion('action', [EditFileReplaceOperationSchema, EditFileDeleteOperationSchema, EditFileInsertOperationSchema]);

export const EditFileOperationSchema = z.discriminatedUnion('action', [EditFileReplaceOperationSchema, EditFileDeleteOperationSchema, EditFileInsertOperationSchema, EditFileReplaceStringOperationSchema, EditFileReplaceRegexOperationSchema]);

export const PreviewEditInputSchema = z.object({
  file: z.string(),
  edits: z.array(EditFileOperationSchema).min(1),
  previousPatchId: z.uuid().optional().describe('If provided, chain this preview onto a previous staged patch. The previous patch\u2019s result is used as the base instead of reading from disk, and the diff shown is incremental (only the changes introduced by this preview).'),
});

export const PreviewEditOutputSchema = z.object({
  patchId: z.uuid(),
  diff: z.string(),
  file: z.string(),
  newContent: z.string(),
  originalHash: z.string(),
});

export const EditFileInputSchema = z.object({
  patchId: z.uuid(),
  file: z.string().describe('Path of the file being edited. Must match the file from the corresponding PreviewEdit call.'),
});

export const EditFileOutputSchema = z.object({
  linesAdded: z.number().int().nonnegative(),
  linesRemoved: z.number().int().nonnegative(),
});
