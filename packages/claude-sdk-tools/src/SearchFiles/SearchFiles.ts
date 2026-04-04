import type { ToolDefinition } from '@shellicar/claude-sdk';
import type { IFileSystem } from '../fs/IFileSystem';
import { SearchFilesInputSchema } from './schema';
import type { SearchFilesOutput } from './types';

export function createSearchFiles(fs: IFileSystem): ToolDefinition<typeof SearchFilesInputSchema, SearchFilesOutput> {
  return {
    name: 'SearchFiles',
    description: 'Search file contents by pattern across a list of files piped from Find. Emits matching lines in path:line:content format. Works on output from Find (file list).',
    operation: 'read',
    input_schema: SearchFilesInputSchema,
    input_examples: [{ pattern: 'export' }, { pattern: 'TODO', caseInsensitive: true }, { pattern: 'operation', context: 1 }],
    handler: async (input) => {
      if (input.content == null) {
        return { type: 'content', values: [], totalLines: 0 };
      }

      const flags = input.caseInsensitive ? 'i' : '';
      const regex = new RegExp(input.pattern, flags);
      const results: string[] = [];

      for (const filePath of input.content.values) {
        let text: string;
        try {
          text = await fs.readFile(filePath);
        } catch {
          continue;
        }

        const lines = text.split('\n');
        const matchedIndices = new Set<number>();

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const ctx = input.context ?? 0;
            const start = Math.max(0, i - ctx);
            const end = Math.min(lines.length - 1, i + ctx);
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
}
