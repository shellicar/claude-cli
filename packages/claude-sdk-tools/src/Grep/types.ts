import { z } from 'zod';
import { GrepInputSchema, GrepOutputSchema } from './schema';

export type GrepInput = z.output<typeof GrepInputSchema>;
export type GrepOutput = z.infer<typeof GrepOutputSchema>;

