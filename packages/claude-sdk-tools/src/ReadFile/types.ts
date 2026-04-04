import { z } from 'zod';
import { ReadFileInputSchema, ReadFileOutputFailureSchema, ReadFileOutputSchema, ReadFileOutputSuccessSchema } from './schema';

export type ReadFileInput = z.output<typeof ReadFileInputSchema>;
export type ReadFileOutput = z.infer<typeof ReadFileOutputSchema>;
export type ReadFileOutputSuccess = z.infer<typeof ReadFileOutputSuccessSchema>;
export type ReadFileOutputFailure = z.infer<typeof ReadFileOutputFailureSchema>;
