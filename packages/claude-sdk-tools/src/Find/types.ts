import { z } from 'zod';
import { FindInputSchema, FindInputTypeSchema, FindOutputSchema } from './schema';

export type FindInput = z.output<typeof FindInputSchema>;
export type FindOutput = z.infer<typeof FindOutputSchema>;
export type FindInputType = z.infer<typeof FindInputTypeSchema>;
