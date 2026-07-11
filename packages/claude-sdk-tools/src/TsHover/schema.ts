import { pathSchema } from '@shellicar/claude-sdk';
import { z } from 'zod';

export const TsHoverInputSchema = z.object({
  file: pathSchema.describe('Path to the TypeScript file. Supports absolute or relative paths.'),
  line: z.number().int().positive().describe('1-based line number.'),
  character: z.number().int().positive().describe('1-based character offset.'),
});

// tsserver returns no symbol at a non-symbol position, so hover info is nullable.
export const TsHoverOutputSchema = z
  .object({
    text: z.string(),
    documentation: z.string().optional(),
    kind: z.string(),
  })
  .nullable();
