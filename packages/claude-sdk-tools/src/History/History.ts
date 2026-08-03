import type { Clock } from '@js-joda/core';
import type { IHistoryReader } from '@shellicar/claude-core/history/interfaces';
import { defineTool } from '@shellicar/claude-sdk';
import { performReadHistory } from './performReadHistory';
import { performSearchHistory } from './performSearchHistory';
import { ReadHistoryInputSchema, ReadHistoryOutputSchema, SearchHistoryInputSchema, SearchHistoryOutputSchema } from './schema';

/**
 * The two history tools over the store's read seam (Phase 1). `SearchHistory` locates — a query returns ranked,
 * cited snippets; `ReadHistory` reads — a citation, or several, returns the exchange around each. Read-only over
 * the index; neither touches the audit.
 *
 * `currentSessionId` is the live session, read afresh on each call (it changes as the CLI starts a new
 * conversation); it is what `includeCurrentSession: false` holds out of results. `clock` carries the reading of now
 * and the user's timezone the `since`/`until` bounds resolve in — a required injection from the composition root, so
 * resolution is deterministic and never reads the ambient host.
 */
export function createHistoryTools(reader: IHistoryReader, currentSessionId: () => string, clock: Clock) {
  const SearchHistory = defineTool({
    name: 'SearchHistory',
    operation: 'read',
    description:
      'Search your past conversations by relevance and get back ranked, cited snippets. A citation is a session id plus a turn id; pass one (or several) to ReadHistory to open the full exchange around it. Thinking is indexed and ranks on par with prose — the reasoning in a thinking block is often the most descriptive account of what a piece of work was.',
    input_schema: SearchHistoryInputSchema,
    output_schema: SearchHistoryOutputSchema,
    input_examples: [{ query: 'why did we drop the reconciliation scan' }, { query: 'sqlite busy_timeout WAL', role: 'assistant', type: 'thinking', since: '2w' }],
    handler: async (input) => {
      return { textContent: performSearchHistory(reader, currentSessionId, clock, input) };
    },
  });

  const ReadHistory = defineTool({
    name: 'ReadHistory',
    operation: 'read',
    description: 'Open the full exchange around one or more search citations. Each citation is a { session, turnId } from a SearchHistory hit; the shared `window` sets how many turns either side of each centre to include. Each event text is capped so one giant tool_result cannot flood context.',
    input_schema: ReadHistoryInputSchema,
    output_schema: ReadHistoryOutputSchema,
    input_examples: [
      { citations: [{ session: 'a1b2c3', turnId: 'turn_9f2c' }] },
      {
        citations: [
          { session: 'a1b2c3', turnId: 'turn_9f2c' },
          { session: 'd4e5f6', turnId: 'turn_1a7b' },
        ],
        window: 5,
      },
    ],
    handler: async (input) => {
      return { textContent: performReadHistory(reader, input) };
    },
  });

  // `as const` returns a readonly tuple, so a caller that destructures keeps each tool's precise type.
  return [SearchHistory, ReadHistory] as const;
}
