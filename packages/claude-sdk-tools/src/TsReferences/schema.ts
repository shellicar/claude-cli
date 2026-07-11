import { pathSchema } from '@shellicar/claude-sdk';
import { z } from 'zod';

export const TsReferencesInputSchema = z.object({
  file: pathSchema.describe('Path to the TypeScript file. Supports absolute or relative paths.'),
  line: z.number().int().positive().describe('1-based line number.'),
  character: z.number().int().positive().describe('1-based character offset.'),
});

export const TsReferencesOutputSchema = z.array(
  z.object({
    file: z.string(),
    line: z.number().int(),
    character: z.number().int(),
    text: z.string(),
  }),
);
