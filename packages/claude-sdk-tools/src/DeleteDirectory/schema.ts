import { z } from 'zod';
import { DeleteOutputSchema, DeleteResultSchema } from '../deleteBatch';
import { PipeFilesSchema } from '../pipe';

export const DeleteDirectoryInputSchema = z.object({
  content: PipeFilesSchema.describe('Pipe input. Directory paths to delete, typically piped from Find. Directories must be empty.'),
});

export { DeleteOutputSchema as DeleteDirectoryOutputSchema, DeleteResultSchema as DeleteDirectoryResultSchema };