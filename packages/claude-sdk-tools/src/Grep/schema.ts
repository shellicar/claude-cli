import { z } from 'zod';
import { PipeInputSchema, RegexSearchOptionsSchema } from '../pipe';

export const GrepInputSchema = RegexSearchOptionsSchema.extend({
  content: PipeInputSchema.optional().describe('Pipe input. Provided by composition layer, not needed for standalone use.'),
});

export const GrepOutputSchema = PipeInputSchema;
