import { pathSchema } from '@shellicar/claude-sdk';
import { z } from 'zod';

export const TsDefinitionInputSchema = z.object({
  file: pathSchema.describe('Path to the TypeScript file. Supports absolute or relative paths.'),
  line: z.number().int().positive().describe('1-based line number.'),
  character: z.number().int().positive().describe('1-based character offset.'),
});

// Definitions grouped by absolute file path, so the path isn't repeated on every entry.
export const TsDefinitionOutputSchema = z.record(
  z.string(),
  z.array(
    z.object({
      line: z.number().int(),
      character: z.number().int(),
    }),
  ),
);
