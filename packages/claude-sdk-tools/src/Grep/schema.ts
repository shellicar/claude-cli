import { z } from 'zod';
import { PipeContentSchema } from '../pipe';

export const GrepMatchSchema = z.object({
  file: z.string().optional().describe('Source file, present when piped from Find'),
  n: z.number().int().describe('Line number'),
  text: z.string().describe('Matching line content'),
});

export const GrepOutputSchema = z.object({
  matches: z.array(GrepMatchSchema),
  totalMatches: z.number().int(),
});

export const GrepInputSchema = z.object({
  pattern: z.string().describe('Regular expression pattern to search for'),
  caseInsensitive: z.boolean().default(false).describe('Case insensitive matching'),
  context: z.number().int().min(0).default(0).describe('Number of lines of context before and after each match'),
  content: PipeContentSchema.optional().describe('Pipe input. Provided by composition layer, not needed for standalone use.'),
});

