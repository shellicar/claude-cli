import { z } from 'zod';
import { PipeInputSchema } from '../pipe';

export const GrepInputSchema = z.object({
  pattern: z.string().describe('Regular expression pattern to search for'),
  caseInsensitive: z.boolean().default(false).describe('Case insensitive matching'),
  context: z.number().int().min(0).default(0).describe('Number of lines of context before and after each match'),
  content: PipeInputSchema.optional().describe('Pipe input. Provided by composition layer, not needed for standalone use.'),
});

export const GrepOutputSchema = PipeInputSchema;
