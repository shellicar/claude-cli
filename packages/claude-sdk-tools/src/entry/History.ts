import { createHistoryTools } from '../History/History';
import { ReadHistoryInputSchema, ReadHistoryOutputSchema, SearchHistoryInputSchema, SearchHistoryOutputSchema } from '../History/schema';
import type { ReadHistoryInput, ReadHistoryOutput, SearchHistoryInput, SearchHistoryOutput } from '../History/types';

export type { ReadHistoryInput, ReadHistoryOutput, SearchHistoryInput, SearchHistoryOutput };
export { createHistoryTools, ReadHistoryInputSchema, ReadHistoryOutputSchema, SearchHistoryInputSchema, SearchHistoryOutputSchema };
