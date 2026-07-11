import { pathSchema } from '@shellicar/claude-sdk';
import { z } from 'zod';

/** A file position (path + 1-based line/character): the shared input shape for the
 * TS tools that act at a single point in a file (hover, references, definition). */
export const positionInputSchema = z.object({
  file: pathSchema.describe('Path to the TypeScript file. Supports absolute or relative paths.'),
  line: z.number().int().positive().describe('1-based line number.'),
  character: z.number().int().positive().describe('1-based character offset.'),
});
