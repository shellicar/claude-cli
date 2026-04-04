import type { z } from 'zod';
import type { CreateFileInputSchema, CreateFileOutputSchema } from './schema';

export type CreateFileInput = z.output<typeof CreateFileInputSchema>;
export type CreateFileOutput = z.infer<typeof CreateFileOutputSchema>;
