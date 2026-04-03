import { z } from 'zod';

export const ReadFileInputSchema = z.object({
  path: z.string().describe('Path to the file. Supports absolute, relative, ~ and $HOME.'),
  offset: z.number().int().min(1).default(1).describe('1-based line number to start reading from.'),
  limit: z.number().int().min(1).max(1000).default(250).describe('Maximum number of lines to return.'),
});

export const ReadFileOutputSuccessSchema = z.object({
  error: z.literal(false),
  content: z.string(),
  startLine: z.int(),
  endLine: z.int(),
  totalLines: z.int(),
});

export const ReadFileOutputFailureSchea = z.object({
  error: z.literal(true),
  message: z.string(),
  path: z.string(),
});

export const ReadFileOutputSchema = z.discriminatedUnion('error', [ReadFileOutputSuccessSchema, ReadFileOutputFailureSchea]);
