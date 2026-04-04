import { z } from 'zod';

export const CreateFileInputSchema = z.object({
  path: z.string().describe('Path to the file to create. Supports absolute, relative, ~ and $HOME.'),
  content: z.string().optional().describe('Initial file content. Defaults to empty.'),
  overwrite: z.boolean().optional().describe('If false (default), error if file already exists. If true, error if file does not exist.'),
});

export const CreateFileOutputSchema = z.discriminatedUnion('error', [
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
