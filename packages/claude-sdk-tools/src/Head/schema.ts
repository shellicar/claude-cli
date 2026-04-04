import { z } from 'zod';
import { PipeInputSchema } from '../pipe';

export const HeadInputSchema = z.object({
  count: z.number().int().min(1).default(10).describe('Number of lines to return from the start'),
  content: PipeInputSchema.optional().describe('Pipe input. Provided by composition layer, not needed for standalone use.'),
});

export const HeadOutputSchema = PipeInputSchema;
