import type { Clock } from '@js-joda/core';
import type { IHistoryReader } from '@shellicar/claude-core/history/interfaces';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { fromLines } from '@shellicar/orchestrate-core';
import { performSearchHistory } from '../../History/performSearchHistory.js';
import { SearchHistoryInputSchema } from '../../History/schema.js';
import { defineToolV2 } from '../defineToolV2.js';

/** The V2 tool equivalent of V1's `SearchHistory` — same `performSearchHistory`, same input
 *  schema, reused verbatim; the only difference is the output shape (one hit per line). */
export function createSearchHistoryToolV2(reader: IHistoryReader, currentSessionId: () => string, clock: Clock) {
  return defineToolV2({
    name: 'SearchHistory',
    description:
      'Search your past conversations by relevance and get back ranked, cited snippets. A citation is a session id plus a turn id; pass one (or several) to ReadHistory to open the full exchange around it. Thinking is indexed and ranks on par with prose — the reasoning in a thinking block is often the most descriptive account of what a piece of work was.',
    operation: 'none',
    model: SearchHistoryInputSchema,
    run: (input): ToolV2Result => {
      async function* run(): AsyncGenerator<string, void, unknown> {
        const hits = performSearchHistory(reader, currentSessionId, clock, input);
        yield `${hits.length} hit(s)`;
        for (const hit of hits) {
          yield JSON.stringify(hit);
        }
      }
      return { stdout: fromLines(run()), success: () => true };
    },
  });
}
