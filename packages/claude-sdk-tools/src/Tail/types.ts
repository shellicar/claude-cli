import { z } from 'zod';
import { TailInputSchema, TailOutputSchema } from './schema';

export type TailInput = z.output<typeof TailInputSchema>;
export type TailOutput = z.infer<typeof TailOutputSchema>;

