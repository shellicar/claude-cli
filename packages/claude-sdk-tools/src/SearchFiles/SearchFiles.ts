import { readFile } from 'node:fs/promises';
import type { ToolDefinition } from '@shellicar/claude-sdk';
import { SearchFilesInputSchema } from './schema';
import type { SearchFilesInput, SearchFilesOutput } from './types';

export const SearchFiles: ToolDefinition<typeof SearchFilesInputSchema, SearchFilesOutput> = {
  name: 'SearchFiles',
  description:
    'Search file contents by pattern across a list of files piped from Find. Emits matching lines in path:line:content format. Works on output from Find (file list).',
  operation: 'read',
  input_schema: SearchFilesInputSchema,
  input_examples: [
    { pattern: 'export' },
    { pattern: 'TODO', caseInsensitive: true },
    { pattern: 'operation', context: 1 },
  ],
  handler: async (input: SearchFilesInput): Promise<SearchFilesOutput> => {
    if (input.content == null) {
      return { type: 'content', values: [], totalLines: 0 };
    }

    const flags = input.caseInsensitive ? 'i' : '';
    const regex = new RegExp(input.pattern, flags);
    const results: string[] = [];

    for (const filePath of input.content.values) {
      let text: string;
      try {
        text = await readFile(filePath, 'utf8');
      } catch {
        continue;
      }

      const lines = text.split('\n');
      const matchedIndices = new Set<number>();

      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const start = Math.max(0, i - input.context);
          const end = Math.min(lines.length - 1, i + input.context);
          for (let j = start; j <= end; j++) {
            matchedIndices.add(j);
          }
        }
      }

      for (const i of [...matchedIndices].sort((a, b) => a - b)) {
        results.push(`${filePath}:${i + 1}:${lines[i]}`);
      }
    }

    return {
      type: 'content',
      values: results,
      totalLines: results.length,
    };
  },
};
