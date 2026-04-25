import { defineTool } from '@shellicar/claude-sdk';
import { HeadInputSchema, HeadOutputSchema } from './schema';

export const Head = defineTool({
  name: 'Head',
  description: 'Return the first N lines of piped content.',
  operation: 'read',
  input_schema: HeadInputSchema,
  output_schema: HeadOutputSchema,
  input_examples: [{ count: 10 }, { count: 50 }],
  handler: async (input) => {
    if (input.content == null) {
      return { textContent: { type: 'content' as const, values: [] as string[], totalLines: 0 } };
    }
    if (input.content.type === 'files') {
      return { textContent: { type: 'files' as const, values: input.content.values.slice(0, input.count) } };
    }
    const sliced = input.content.values.slice(0, input.count);
    return {
      textContent: {
        type: 'content' as const,
        values: sliced,
        totalLines: input.content.totalLines,
        path: input.content.path,
        lineNumbers: input.content.lineNumbers?.slice(0, input.count),
      },
    };
  },
});
