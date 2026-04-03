import { z } from 'zod';
import { GrepFileInputSchema, GrepFileOutputSchema, GrepFileOutputSuccessSchema, GrepFileOutputFailureSchema } from './schema';

export type GrepFileInput = z.output<typeof GrepFileInputSchema>;
export type GrepFileOutput = z.input<typeof GrepFileOutputSchema>;
export type GrepFileOutputSuccess = z.input<typeof GrepFileOutputSuccessSchema>;
export type GrepFileOutputFailure = z.input<typeof GrepFileOutputFailureSchema>;
