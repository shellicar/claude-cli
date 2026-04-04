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
    const lines = input.content?.lines ?? [];
    const flags = input.caseInsensitive ? 'i' : '';
    const regex = new RegExp(input.pattern, flags);

    const matched: Array<{ n: number; text: string; file?: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (regex.test(line.text)) {
        if (input.context > 0) {
          const start = Math.max(0, i - input.context);
          const end = Math.min(lines.length - 1, i + input.context);
          for (let j = start; j <= end; j++) {
            const ctx = lines[j];
            if (!matched.find((m) => m.n === ctx.n && m.file === ctx.file)) {
              matched.push({ n: ctx.n, text: ctx.text, file: ctx.file });
            }
          }
        } else {
          matched.push({ n: line.n, text: line.text, file: line.file });
        }
      }
    }

    return {
      matches: matched,
      totalMatches: matched.length,
    };
  },
};

