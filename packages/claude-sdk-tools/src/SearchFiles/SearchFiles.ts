import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { defineTool } from '@shellicar/claude-sdk';
import { collectMatchedIndices } from '../collectMatchedIndices';
import { SearchFilesInputSchema, SearchFilesOutputSchema } from './schema';

export function createSearchFiles(fs: IFileSystem) {
  return defineTool({
    name: 'SearchFiles',
    description: 'Search file contents by pattern across a list of files piped from Find. Emits matching lines in path:line:content format. Works on output from Find (file list).',
    operation: 'read',
    input_schema: SearchFilesInputSchema,
    output_schema: SearchFilesOutputSchema,
    input_examples: [{ pattern: 'export' }, { pattern: 'TODO', caseInsensitive: true }, { pattern: 'operation', context: 1 }],
    handler: async (input) => {
      if (input.content == null) {
        return { textContent: { type: 'content' as const, values: [] as string[], totalLines: 0 } };
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
        for (const i of collectMatchedIndices(lines, regex, input.context ?? 0)) {
          results.push(`${filePath}:${i + 1}:${lines[i]}`);
        }
      }
      return {
        textContent: {
          type: 'content' as const,
          values: results,
          totalLines: results.length,
        },
      };
    },
  });
}
