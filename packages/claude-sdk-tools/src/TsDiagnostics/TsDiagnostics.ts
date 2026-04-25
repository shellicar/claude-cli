import { defineTool } from '@shellicar/claude-sdk';
import { z } from 'zod';
import type { Diagnostic, ITypeScriptService } from '../typescript/ITypeScriptService';
import { TsDiagnosticsInputSchema } from './schema';

export type TsDiagnosticsOutput = {
  file: string;
  diagnostics: Diagnostic[];
  count: number;
};

export function createTsDiagnostics(ts: ITypeScriptService) {
  return defineTool({
    operation: 'read',
    name: 'TsDiagnostics',
    description: 'Get TypeScript diagnostics (type errors, syntax errors) for a file. Returns structured diagnostic information including line, character, message, and error code.',
    input_schema: TsDiagnosticsInputSchema,
    output_schema: z.unknown(),
    input_examples: [{ file: 'src/index.ts' }, { file: 'src/runAgent.ts', severity: 'error' }],
    handler: async (input) => {
      const diagnostics = await ts.getDiagnostics({
        file: input.file,
        severity: input.severity,
      });

      return {
        textContent: {
          file: input.file,
          diagnostics,
          count: diagnostics.length,
        },
      };
    },
  });
}
