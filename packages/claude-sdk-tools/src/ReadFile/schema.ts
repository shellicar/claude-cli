import { z } from 'zod';
import { PipeContentSchema } from '../Head/schema';

export const ReadFileInputSchema = z.object({
  path: z.string().describe('Path to the file. Supports absolute, relative, ~ and $HOME.'),
});

export const ReadFileOutputSuccessSchema = PipeContentSchema;

export const ReadFileOutputFailureSchema = z.object({
  error: z.literal(true),
  message: z.string(),
  path: z.string(),
});

export const ReadFileOutputSchema = z.union([
  ReadFileOutputSuccessSchema,
  ReadFileOutputFailureSchema,
]);
