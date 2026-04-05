import type { z } from 'zod';
import type { PipeStepSchema, PipeToolInputSchema } from './schema';

export type PipeStep = z.infer<typeof PipeStepSchema>;
export type PipeToolInput = z.infer<typeof PipeToolInputSchema>;
