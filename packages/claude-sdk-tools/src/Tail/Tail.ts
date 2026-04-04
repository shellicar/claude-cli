import type { ToolDefinition } from '@shellicar/claude-sdk';
import type { TailInput, TailOutput } from './types';
import { TailInputSchema } from './schema';

export const Tail: ToolDefinition<TailInput, TailOutput> = {
  name: 'Tail',
  description: 'Return the last N lines of piped content.',
  input_schema: TailInputSchema,
  input_examples: [
    { count: 10 },
    { count: 50 },
  ],
  handler: async (input) => {
    const lines = input.content?.lines ?? [];
    const totalLines = input.content?.totalLines ?? 0;
    return {
      lines: lines.slice(-input.count),
      totalLines,
      path: input.content?.path,
    };
  },
};

