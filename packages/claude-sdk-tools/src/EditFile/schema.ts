import { pathSchema } from '@shellicar/claude-sdk';
import { z } from 'zod';
import { regexPattern } from '../regexPattern';

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
  after_line: z.number().int().describe('1-based line number to insert after. 0 inserts at the top of the file. Negative counts back from the end (-1 = after the last line, -2 = after the second-last), so appending does not require knowing the line count.'),
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
  pattern: regexPattern('Find text to replace', ['const\\s+\\w+']),
  replacement: z.string().describe('Replacement string. Supports capture groups ($1, $2), $& (matched text), $$ (literal $).'),
  replaceMultiple: z.boolean().optional().default(false).describe('If true, replace all matches. If false (default), error if more than one match is found.'),
});

export const EditFileLineOperationSchema = z.discriminatedUnion('action', [EditFileReplaceOperationSchema, EditFileDeleteOperationSchema, EditFileInsertOperationSchema]);

export const EditFileTextOperationSchema = z.discriminatedUnion('action', [EditFileReplaceStringOperationSchema, EditFileReplaceRegexOperationSchema]);

// Alias kept so applyEdits.ts does not need to change its import.
export const EditFileResolvedOperationSchema = EditFileLineOperationSchema;

export const EditFileInputSchema = z
  .object({
    file: pathSchema,
    lineEdits: z
      .array(EditFileLineOperationSchema)
      .optional()
      .default([])
      .describe('Structural edits by line number (insert / replace / delete). Applied bottom-to-top so all line numbers refer to the file as it exists before this call — no offset calculation needed. If two edits target the same lines, an error is thrown.'),
    textEdits: z.array(EditFileTextOperationSchema).optional().default([]).describe('Text-search edits (replace_text / regex_text). Applied in order after all lineEdits.'),
  })
  .refine((input) => input.lineEdits.length > 0 || input.textEdits.length > 0, {
    message: 'At least one edit must be provided (lineEdits or textEdits)',
  });

export const EditFileOutputSchema = z.string().describe('A line-numbered diff of the change, e.g. " 10:context", "-11:old", "+11:new". Line numbers on context/added lines are the new file\'s; removed lines carry the original file\'s.');
