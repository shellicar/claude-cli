import type { ToolDefinition } from '@shellicar/claude-sdk';
import type { HeadInput, HeadOutput } from './types';
import { HeadInputSchema } from './schema';

export const Head: ToolDefinition<HeadInput, HeadOutput> = {
  name: 'Head',
  description: 'Return the first N lines of piped content.',
  input_schema: HeadInputSchema,
  input_examples: [
    { count: 10 },
    { count: 50 },
  ],
  handler: async (input) => {
    const lines = input.content?.lines ?? [];
    const totalLines = input.content?.totalLines ?? 0;
    return {
      lines: lines.slice(0, input.count),
      totalLines,
      path: input.content?.path,
    };
  },
};

