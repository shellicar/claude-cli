import type { ToolDefinition } from '@shellicar/claude-sdk';
import type { GrepInput, GrepOutput } from './types';
import { GrepInputSchema } from './schema';

export const Grep: ToolDefinition<typeof GrepInputSchema, GrepOutput> = {
  name: 'Grep',
  description: 'Filter lines matching a pattern from piped content. Works on output from ReadFile (lines) or Find (file list).',
  input_schema: GrepInputSchema,
  input_examples: [
    { pattern: 'export' },
    { pattern: 'TODO', caseInsensitive: true },
    { pattern: 'error', context: 2 },
  ],
  handler: async (input) => {
    const flags = input.caseInsensitive ? 'i' : '';
    const regex = new RegExp(input.pattern, flags);

    if (input.content == null) {
      return { type: 'content', values: [], totalLines: 0 };
    }

    if (input.content.type === 'files') {
      return {
        type: 'files',
        values: input.content.values.filter((v) => regex.test(v)),
      };
    }

    // PipeContent — filter with optional context
    const values = input.content.values;
    const matchedIndices = new Set<number>();

    for (let i = 0; i < values.length; i++) {
      if (regex.test(values[i])) {
        const start = Math.max(0, i - input.context);
        const end = Math.min(values.length - 1, i + input.context);
        for (let j = start; j <= end; j++) {
          matchedIndices.add(j);
        }
      }
    }

    const filtered = [...matchedIndices].sort((a, b) => a - b).map((i) => values[i]);

    return {
      type: 'content',
      values: filtered,
      totalLines: input.content.totalLines,
      path: input.content.path,
    };
  },
};
