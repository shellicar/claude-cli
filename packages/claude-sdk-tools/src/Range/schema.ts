import { z } from 'zod';
import { PipeInputSchema } from '../pipe';

export const RangeInputSchema = z.object({
  start: z.number().int().min(1).describe('1-based start position in piped values (inclusive)'),
  end: z.number().int().min(1).describe('1-based end position in piped values (inclusive)'),
  content: PipeInputSchema.optional().describe('Pipe input. Provided by composition layer, not needed for standalone use.'),
});

export const RangeOutputSchema = PipeInputSchema;
