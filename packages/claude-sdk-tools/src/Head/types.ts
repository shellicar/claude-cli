import { z } from 'zod';
import { HeadInputSchema, HeadOutputSchema } from './schema';

export type HeadInput = z.output<typeof HeadInputSchema>;
export type HeadOutput = z.infer<typeof HeadOutputSchema>;
