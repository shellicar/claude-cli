import { defineTool } from '@shellicar/claude-sdk';
import { z } from 'zod';
import type { ITypeScriptService, Reference } from '../typescript/ITypeScriptService';
import { TsReferencesInputSchema } from './schema';

export function createTsReferences(ts: ITypeScriptService) {
  return defineTool({
    operation: 'read',
    name: 'TsReferences',
    description: 'Find all references to a symbol at a specific position in a TypeScript file. Returns every location where the symbol is used across the project, including the definition site.',
    input_schema: TsReferencesInputSchema,
    output_schema: z.unknown(),
    input_examples: [{ file: 'src/index.ts', line: 5, character: 13 }],
    handler: async (input) => {
      const result = await ts.getReferences({
        file: input.file,
        line: input.line,
        character: input.character,
      });
      return { textContent: result };
    },
  });
}
