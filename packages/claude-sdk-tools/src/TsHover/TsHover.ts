import { defineTool } from '@shellicar/claude-sdk';
import type { HoverInfo, ITypeScriptService } from '../typescript/ITypeScriptService';
import { TsHoverInputSchema } from './schema';

export function createTsHover(ts: ITypeScriptService) {
  return defineTool({
    operation: 'read',
    name: 'TsHover',
    description: 'Get type information and documentation for a symbol at a specific position in a TypeScript file. Returns the type signature, symbol kind, and any JSDoc documentation.',
    input_schema: TsHoverInputSchema,
    input_examples: [{ file: 'src/index.ts', line: 12, character: 8 }],
    handler: async (input): Promise<HoverInfo | null> => {
      return ts.getHoverInfo({
        file: input.file,
        line: input.line,
        character: input.character,
      });
    },
  });
}
