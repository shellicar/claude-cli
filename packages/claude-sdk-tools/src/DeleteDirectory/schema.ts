import { z } from 'zod';
import { PipeContentSchema } from '../pipe';

export const DeleteDirectoryInputSchema = z.object({
  content: PipeContentSchema.describe('Pipe input. Directory paths to delete, typically piped from Find. Directories must be empty.'),
});

export const DeleteDirectoryResultSchema = z.object({
  path: z.string(),
  error: z.string().optional(),
});

export const DeleteDirectoryOutputSchema = z.object({
  deleted: z.array(z.string()),
  errors: z.array(DeleteDirectoryResultSchema),
  totalDeleted: z.number().int(),
  totalErrors: z.number().int(),
});
