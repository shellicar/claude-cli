import type { z } from 'zod';
import type { SearchFilesInputSchema, SearchFilesOutputSchema } from './schema';

export type SearchFilesInput = z.output<typeof SearchFilesInputSchema>;
export type SearchFilesOutput = z.infer<typeof SearchFilesOutputSchema>;
