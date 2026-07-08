import { pathSchema } from '@shellicar/claude-sdk';
import { z } from 'zod';
import { DeleteOutputSchema, DeleteResultSchema } from '../deleteBatch';

export const DeleteFileInputSchema = z.object({
  files: z.array(pathSchema).describe('File paths to delete.'),
});

export { DeleteOutputSchema as DeleteFileOutputSchema, DeleteResultSchema as DeleteFileResultSchema };
