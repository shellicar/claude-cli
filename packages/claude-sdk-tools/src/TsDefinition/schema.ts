import { z } from 'zod';

export const TsDefinitionInputSchema = z.object({
  file: z.string().describe('Path to the TypeScript file. Supports absolute or relative paths.'),
  line: z.number().int().positive().describe('1-based line number.'),
  character: z.number().int().positive().describe('1-based character offset.'),
});
