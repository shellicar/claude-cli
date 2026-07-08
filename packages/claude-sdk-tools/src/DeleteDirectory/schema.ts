import { pathSchema } from '@shellicar/claude-sdk';
import { z } from 'zod';
import { DeleteOutputSchema, DeleteResultSchema } from '../deleteBatch';

export const DeleteDirectoryInputSchema = z.object({
  files: z.array(pathSchema).describe('Directory paths to delete. Directories must be empty — delete the files inside first.'),
});

export { DeleteOutputSchema as DeleteDirectoryOutputSchema, DeleteResultSchema as DeleteDirectoryResultSchema };
