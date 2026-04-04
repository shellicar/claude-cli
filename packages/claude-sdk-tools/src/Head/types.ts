import { z } from 'zod';
import { HeadInputSchema, HeadOutputSchema, LineSchema, PipeContentSchema } from './schema';

export type Line = z.infer<typeof LineSchema>;
export type PipeContent = z.infer<typeof PipeContentSchema>;
export type HeadInput = z.output<typeof HeadInputSchema>;
export type HeadOutput = z.infer<typeof HeadOutputSchema>;

