import { z } from 'zod';
import { DeleteOutputSchema, DeleteResultSchema } from '../deleteBatch';
import { PipeFilesSchema } from '../pipe';

export const DeleteFileInputSchema = z.object({
  content: PipeFilesSchema.describe('Pipe input. Paths to delete, typically piped from Find.'),
});

export { DeleteOutputSchema as DeleteFileOutputSchema, DeleteResultSchema as DeleteFileResultSchema };
