import { defineTool } from '@shellicar/claude-sdk';
import { RangeInputSchema, RangeOutputSchema } from './schema';

export const Range = defineTool({
  name: 'Range',
  description: 'Return lines between start and end (inclusive) from piped content.',
  operation: 'read',
  input_schema: RangeInputSchema,
  output_schema: RangeOutputSchema,
  input_examples: [
    { start: 1, end: 50 },
    { start: 100, end: 200 },
  ],
  handler: async (input) => {
    if (input.content == null) {
      return { textContent: { type: 'content' as const, values: [] as string[], totalLines: 0 } };
    }
    const sliced = input.content.values.slice(input.start - 1, input.end);
    if (input.content.type === 'files') {
      return { textContent: { type: 'files' as const, values: sliced } };
    }
    return {
      textContent: {
        type: 'content' as const,
        values: sliced,
        totalLines: input.content.totalLines,
        path: input.content.path,
        lineNumbers: input.content.lineNumbers?.slice(input.start - 1, input.end),
      },
    };
  },
});
