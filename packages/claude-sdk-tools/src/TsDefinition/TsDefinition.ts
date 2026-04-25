import { defineTool } from '@shellicar/claude-sdk';
import { z } from 'zod';
import type { Definition, ITypeScriptService } from '../typescript/ITypeScriptService';
import { TsDefinitionInputSchema } from './schema';

export function createTsDefinition(ts: ITypeScriptService) {
  return defineTool({
    operation: 'read',
    name: 'TsDefinition',
    description: 'Go to the definition of a symbol at a specific position in a TypeScript file. Returns the file and position where the symbol is defined. May return multiple locations for overloaded functions or declaration merging.',
    input_schema: TsDefinitionInputSchema,
    output_schema: z.unknown(),
    input_examples: [{ file: 'src/index.ts', line: 3, character: 20 }],
    handler: async (input) => {
      const result = await ts.getDefinition({
        file: input.file,
        line: input.line,
        character: input.character,
      });
      return { textContent: result as Definition[] };
    },
  });
}
