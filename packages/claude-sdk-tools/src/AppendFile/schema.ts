import { z } from 'zod';

export const AppendFileInputSchema = z.object({
  path: z.string().describe('Path to the file to append to. Supports absolute, relative, ~ and $HOME.'),
  content: z.string().describe('Text to append to the end of the file. Written verbatim; no separator is inserted at the seam.'),
});

export const AppendFileOutputSchema = z.discriminatedUnion('error', [
  z.object({
    error: z.literal(false),
    path: z.string(),
  }),
  z.object({
    error: z.literal(true),
    message: z.string(),
    path: z.string(),
  }),
]);
