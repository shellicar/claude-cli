import { defineTool } from '@shellicar/claude-sdk';
import { TailInputSchema, TailOutputSchema } from './schema';

export const Tail = defineTool({
  name: 'Tail',
  description: 'Return the last N lines of piped content.',
  operation: 'read',
  input_schema: TailInputSchema,
  output_schema: TailOutputSchema,
  input_examples: [{ count: 10 }, { count: 50 }],
  handler: async (input) => {
    if (input.content == null) {
      return { textContent: { type: 'content' as const, values: [] as string[], totalLines: 0 } };
    }
    if (input.content.type === 'files') {
      return { textContent: { type: 'files' as const, values: input.content.values.slice(-input.count) } };
    }
    const sliced = input.content.values.slice(-input.count);
    return {
      textContent: {
        type: 'content' as const,
        values: sliced,
        totalLines: input.content.totalLines,
        path: input.content.path,
        lineNumbers: input.content.lineNumbers?.slice(-input.count),
      },
    };
  },
});
