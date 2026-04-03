import { z } from 'zod';

export const GrepFileInputSchema = z.object({
  path: z.string().describe('Path to the file. Supports absolute, relative, ~ and $HOME.'),
  pattern: z.string().describe('Regular expression pattern to search for.'),
  context: z.number().int().min(0).max(5).default(3).describe('Number of context lines before and after each match.'),
  limit: z.number().int().min(1).max(20).default(10).describe('Max number of results'),
  skip: z.number().int().min(0).default(0).describe('Number of results to skip'),
  maxLineLength: z.number().int().min(50).max(500).default(200).describe('Maximum characters per line before truncation.'),
});

export const GrepFileOutputSuccessSchema = z.object({
  error: z.literal(false),
  matchCount: z.int(),
  content: z.string(),
});

export const GrepFileOutputFailureSchema = z.object({
  error: z.literal(true),
  message: z.string(),
  path: z.string(),
});

export const GrepFileOutputSchema = z.discriminatedUnion('error', [
  GrepFileOutputSuccessSchema,
  GrepFileOutputFailureSchema,
]);
