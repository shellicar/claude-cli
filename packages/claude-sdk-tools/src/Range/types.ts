import type { z } from 'zod';
import type { RangeInputSchema, RangeOutputSchema } from './schema';

export type RangeInput = z.output<typeof RangeInputSchema>;
export type RangeOutput = z.infer<typeof RangeOutputSchema>;
