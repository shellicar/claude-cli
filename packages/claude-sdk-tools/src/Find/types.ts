import { z } from 'zod';
import { FindInputSchema, FindOutputSchema } from './schema';

export type FindInput = z.output<typeof FindInputSchema>;
export type FindOutput = z.infer<typeof FindOutputSchema>;
