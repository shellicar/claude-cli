import type { z } from 'zod';
import type { ReadHistoryInputSchema, ReadHistoryOutputSchema, SearchHistoryInputSchema, SearchHistoryOutputSchema } from './schema';

export type SearchHistoryInput = z.output<typeof SearchHistoryInputSchema>;
export type SearchHistoryOutput = z.output<typeof SearchHistoryOutputSchema>;
export type ReadHistoryInput = z.output<typeof ReadHistoryInputSchema>;
export type ReadHistoryOutput = z.output<typeof ReadHistoryOutputSchema>;
