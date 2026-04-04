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
    if (input.content == null) {
      return { type: 'content', values: [], totalLines: 0 };
    }
    const sliced = input.content.values.slice(input.start - 1, input.end);
    if (input.content.type === 'files') {
      return { type: 'files', values: sliced };
    }
    return {
      type: 'content',
      values: sliced,
      totalLines: input.content.totalLines,
      path: input.content.path,
    };
  },
};
