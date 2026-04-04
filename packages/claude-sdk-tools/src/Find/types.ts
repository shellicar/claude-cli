import { z } from 'zod';
import { FindInputSchema, FindOutputFailureSchema, FindOutputSchema, FindOutputSuccessSchema } from './schema';

export type FindInput = z.output<typeof FindInputSchema>;
export type FindOutput = z.infer<typeof FindOutputSchema>;
export type FindOutputSuccess = z.infer<typeof FindOutputSuccessSchema>;
export type FindOutputFailure = z.infer<typeof FindOutputFailureSchema>;
