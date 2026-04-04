import { z } from 'zod';
import { PipeContentSchema } from '../pipe';

export const RangeInputSchema = z.object({
  start: z.number().int().min(1).describe('1-based start line number (inclusive)'),
  end: z.number().int().min(1).describe('1-based end line number (inclusive)'),
  content: PipeContentSchema.optional().describe('Pipe input. Provided by composition layer, not needed for standalone use.'),
});

export const RangeOutputSchema = PipeContentSchema;

