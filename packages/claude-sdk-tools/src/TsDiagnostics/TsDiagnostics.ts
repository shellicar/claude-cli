import { defineTool } from '@shellicar/claude-sdk';
import type { z } from 'zod';
import type { ITypeScriptService } from '../typescript/ITypeScriptService';
import { TsDiagnosticsInputSchema, TsDiagnosticsOutputSchema } from './schema';

export type TsDiagnosticsOutput = z.output<typeof TsDiagnosticsOutputSchema>;

export function createTsDiagnostics(ts: ITypeScriptService) {
  return defineTool({
    operation: 'read',
    name: 'TsDiagnostics',
    description: 'Get TypeScript diagnostics (type errors, syntax errors) for one or more files. Returns diagnostics grouped by file path, each entry including line, character, message, and error code.',
    input_schema: TsDiagnosticsInputSchema,
    output_schema: TsDiagnosticsOutputSchema,
    input_examples: [{ files: [{ file: 'src/index.ts' }] }, { files: [{ file: 'src/runAgent.ts', severity: 'error' }, { file: 'src/index.ts' }] }],
    handler: async (input) => {
      // Group by file path so the absolute path is the key, not repeated on every entry.
      // Each file runs on the same per-block server, so a batch is one spawn.
      const grouped: TsDiagnosticsOutput = {};
      for (const target of input.files) {
        const diagnostics = await ts.getDiagnostics({ file: target.file, severity: target.severity });
        for (const { file, ...entry } of diagnostics) {
          (grouped[file] ??= []).push(entry);
        }
      }

      return { textContent: grouped };
    },
  });
}
