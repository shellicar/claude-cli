import { z } from 'zod';
import { PipeFilesSchema } from '../pipe';

export const DeleteFileInputSchema = z.object({
  content: PipeFilesSchema.describe('Pipe input. Paths to delete, typically piped from Find.'),
});

export const DeleteFileResultSchema = z.object({
  path: z.string(),
  error: z.string().optional(),
});

export const DeleteFileOutputSchema = z.object({
  deleted: z.array(z.string()),
  errors: z.array(DeleteFileResultSchema),
  totalDeleted: z.number().int(),
  totalErrors: z.number().int(),
});
