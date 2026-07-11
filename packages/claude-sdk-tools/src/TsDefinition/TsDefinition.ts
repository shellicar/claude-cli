import { defineTool } from '@shellicar/claude-sdk';
import type { z } from 'zod';
import type { ITypeScriptService } from '../typescript/ITypeScriptService';
import { TsDefinitionInputSchema, TsDefinitionOutputSchema } from './schema';

export type TsDefinitionOutput = z.output<typeof TsDefinitionOutputSchema>;

export function createTsDefinition(ts: ITypeScriptService) {
  return defineTool({
    operation: 'read',
    name: 'TsDefinition',
    description: 'Go to the definition of a symbol at a specific position in a TypeScript file. Returns the definition positions grouped by file path. May return multiple locations for overloaded functions or declaration merging.',
    input_schema: TsDefinitionInputSchema,
    output_schema: TsDefinitionOutputSchema,
    input_examples: [{ file: 'src/index.ts', line: 3, character: 20 }],
    handler: async (input) => {
      const definitions = await ts.getDefinition({
        file: input.file,
        line: input.line,
        character: input.character,
      });

      // Group by file path so the absolute path is the key, not repeated on every entry.
      const grouped: TsDefinitionOutput = {};
      for (const { file, ...entry } of definitions) {
        (grouped[file] ??= []).push(entry);
      }

      return { textContent: grouped };
    },
  });
}
