import type { z } from 'zod';
import type { GrepInputSchema, GrepOutputSchema } from './schema';

export type GrepInput = z.output<typeof GrepInputSchema>;
export type GrepOutput = z.infer<typeof GrepOutputSchema>;
