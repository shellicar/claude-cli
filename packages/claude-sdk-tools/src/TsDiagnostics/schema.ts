import { z } from 'zod';

export const TsDiagnosticsInputSchema = z.object({
  file: z.string().describe('Path to the TypeScript file to check. Supports absolute or relative paths.'),
  severity: z.enum(['error', 'warning', 'suggestion', 'all']).default('error').describe('Filter diagnostics by severity. Defaults to error.'),
});
