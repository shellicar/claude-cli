import { defineTool } from '@shellicar/claude-sdk';
import type { z } from 'zod';
import type { ITypeScriptService } from '../typescript/ITypeScriptService';
import { TsDiagnosticsInputSchema, TsDiagnosticsOutputSchema } from './schema';

export type TsDiagnosticsOutput = z.output<typeof TsDiagnosticsOutputSchema>;

export function createTsDiagnostics(ts: ITypeScriptService) {
  return defineTool({
    operation: 'read',
    name: 'TsDiagnostics',
    description: 'Get TypeScript diagnostics (type errors, syntax errors) for a file. Returns structured diagnostic information including line, character, message, and error code.',
    input_schema: TsDiagnosticsInputSchema,
    output_schema: TsDiagnosticsOutputSchema,
    input_examples: [{ file: 'src/index.ts' }, { file: 'src/runAgent.ts', severity: 'error' }],
    handler: async (input) => {
      const diagnostics = await ts.getDiagnostics({
        file: input.file,
        severity: input.severity,
      });

      // Group by file path so the absolute path is the key, not repeated on every entry.
      const grouped: TsDiagnosticsOutput = {};
      for (const { file, ...entry } of diagnostics) {
        (grouped[file] ??= []).push(entry);
      }

      return { textContent: grouped };
    },
  });
}
