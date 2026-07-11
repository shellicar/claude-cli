import { defineTool } from '@shellicar/claude-sdk';
import type { z } from 'zod';
import { groupByFile } from '../typescript/groupByFile';
import type { ITypeScriptService } from '../typescript/ITypeScriptService';
import { TsReferencesInputSchema, TsReferencesOutputSchema } from './schema';

export type TsReferencesOutput = z.output<typeof TsReferencesOutputSchema>;

export function createTsReferences(ts: ITypeScriptService) {
  return defineTool({
    operation: 'read',
    name: 'TsReferences',
    description: 'Find all references to a symbol at a specific position in a TypeScript file. Returns every location where the symbol is used across the project, grouped by file path, including the definition site.',
    input_schema: TsReferencesInputSchema,
    output_schema: TsReferencesOutputSchema,
    input_examples: [{ file: 'src/index.ts', line: 5, character: 13 }],
    handler: async (input) => {
      const references = await ts.getReferences({
        file: input.file,
        line: input.line,
        character: input.character,
      });

      // Group by file path so the absolute path is the key, not repeated on every entry.
      return { textContent: groupByFile(references) };
    },
  });
}
