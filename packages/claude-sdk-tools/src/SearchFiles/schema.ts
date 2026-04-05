import { PipeContentSchema, PipeFilesSchema, RegexSearchOptionsSchema } from '../pipe';

export const SearchFilesInputSchema = RegexSearchOptionsSchema.extend({
  content: PipeFilesSchema.optional().describe('Pipe input. Provided by composition layer, not needed for standalone use.'),
});

export const SearchFilesOutputSchema = PipeContentSchema;
