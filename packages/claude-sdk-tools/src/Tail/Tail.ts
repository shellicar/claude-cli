import { defineTool } from '@shellicar/claude-sdk';
import { TailInputSchema } from './schema';

export const Tail = defineTool({
  name: 'Tail',
  description: 'Return the last N lines of piped content.',
  operation: 'read',
  input_schema: TailInputSchema,
  input_examples: [{ count: 10 }, { count: 50 }],
  handler: async (input) => {
    if (input.content == null) {
      return { type: 'content', values: [], totalLines: 0 };
    }
    if (input.content.type === 'files') {
      return { type: 'files', values: input.content.values.slice(-input.count) };
    }
    return {
      type: 'content',
      values: input.content.values.slice(-input.count),
      totalLines: input.content.totalLines,
      path: input.content.path,
    };
  },
});
