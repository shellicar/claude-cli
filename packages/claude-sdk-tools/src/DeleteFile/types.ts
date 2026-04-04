import { z } from 'zod';
import { DeleteFileInputSchema, DeleteFileOutputSchema, DeleteFileResultSchema } from './schema';

export type DeleteFileInput = z.output<typeof DeleteFileInputSchema>;
export type DeleteFileOutput = z.infer<typeof DeleteFileOutputSchema>;
export type DeleteFileResult = z.infer<typeof DeleteFileResultSchema>;

