import { pathSchema } from '@shellicar/claude-sdk';
import { z } from 'zod';

export const TsDiagnosticsInputSchema = z.object({
  files: z
    .array(
      z.object({
        file: pathSchema.describe('Path to the TypeScript file to check. Supports absolute or relative paths.'),
        severity: z.enum(['error', 'warning', 'suggestion', 'all']).default('error').describe('Filter diagnostics by severity. Defaults to error.'),
      }),
    )
    .min(1)
    .describe('Files to check, each with its own optional severity filter. One call checks the whole batch on a single tsserver spawn.'),
});

export const DiagnosticSeveritySchema = z.enum(['error', 'warning', 'suggestion', 'unknown']);

// A single diagnostic without its file path: the path is the grouping key in the output.
export const TsDiagnosticEntrySchema = z.object({
  line: z.number().int(),
  character: z.number().int(),
  message: z.string(),
  code: z.number().int(),
  severity: DiagnosticSeveritySchema,
});

// Diagnostics grouped by absolute file path, so the path isn't repeated on every entry.
export const TsDiagnosticsOutputSchema = z.record(z.string(), z.array(TsDiagnosticEntrySchema));
