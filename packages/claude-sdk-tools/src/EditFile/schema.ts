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

export const EditFileLineOperationSchema = z.discriminatedUnion('action', [EditFileReplaceOperationSchema, EditFileDeleteOperationSchema, EditFileInsertOperationSchema]);

export const EditFileTextOperationSchema = z.discriminatedUnion('action', [EditFileReplaceStringOperationSchema, EditFileReplaceRegexOperationSchema]);

// Alias kept so applyEdits.ts does not need to change its import.
export const EditFileResolvedOperationSchema = EditFileLineOperationSchema;

export const PreviewEditInputSchema = z
  .object({
    file: z.string(),
    lineEdits: z
      .array(EditFileLineOperationSchema)
      .optional()
      .default([])
      .describe('Structural edits by line number (insert / replace / delete). Applied bottom-to-top so all line numbers refer to the file as it exists before this call — no offset calculation needed. If two edits target the same lines, an error is thrown.'),
    textEdits: z.array(EditFileTextOperationSchema).optional().default([]).describe('Text-search edits (replace_text / regex_text). Applied in order after all lineEdits.'),
    previousPatchId: z
      .uuid()
      .optional()
      .describe(
        "If provided, chain this preview onto a previous staged patch. The previous patch\u2019s result is used as the base instead of reading from disk, and the diff shown is incremental (only the changes introduced by this preview). To apply the full accumulated result, call EditFile with the final patchId in the chain — do not call EditFile on intermediate patches before the final one, as each patch validates against the original disk state rather than the previous patch's result.",
      ),
    append: z.string().optional().describe('Append content to the end of the file. Mutually exclusive with lineEdits and textEdits.'),
  })
  .refine((input) => input.lineEdits.length > 0 || input.textEdits.length > 0 || input.append != null, {
    message: 'At least one edit must be provided (lineEdits, textEdits, or append)',
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
