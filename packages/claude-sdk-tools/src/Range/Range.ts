import type { ToolDefinition } from '@shellicar/claude-sdk';
import type { RangeInput, RangeOutput } from './types';
import { RangeInputSchema } from './schema';

export const Range: ToolDefinition<typeof RangeInputSchema, RangeOutput> = {
  name: 'Range',
  description: 'Return lines between start and end (inclusive) from piped content.',
  input_schema: RangeInputSchema,
  input_examples: [
    { start: 1, end: 50 },
    { start: 100, end: 200 },
  ],
  handler: async (input) => {
    const lines = input.content?.lines ?? [];
    const totalLines = input.content?.totalLines ?? 0;
    return {
      lines: lines.filter((line) => line.n >= input.start && line.n <= input.end),
      totalLines,
      path: input.content?.path,
    };
  },
};

