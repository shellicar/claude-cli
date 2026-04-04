import type { z } from 'zod';
import type { TailInputSchema, TailOutputSchema } from './schema';

export type TailInput = z.output<typeof TailInputSchema>;
export type TailOutput = z.infer<typeof TailOutputSchema>;
