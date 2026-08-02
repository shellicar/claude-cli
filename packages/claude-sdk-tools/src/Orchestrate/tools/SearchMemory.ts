import type { IMemoryStore } from '@shellicar/claude-core/memory/interfaces';
import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { fromLines } from '@shellicar/orchestrate-core';
import { SearchMemoryInputSchema } from '../../Memory/schema.js';
import { defineToolV2 } from '../defineToolV2.js';

/** The V2 tool equivalent of V1's `SearchMemory` — same `IMemoryStore.search`, same input schema.
 *  One hit per line makes the result pipeable into Head/Match like any other V2 tool's output. */
export function createSearchMemoryToolV2(store: IMemoryStore) {
  return defineToolV2({
    name: 'SearchMemory',
    description:
      'Search every memory by relevance. Describe what you need in plain words; the most relevant memories come back ranked, best first. Optionally narrow to one type. Results are NOT scoped to the current repository — search spans every memory in the store. Each hit carries the environment (host/org/repo) it was written in; that is there to help you judge whether a memory is relevant to what you are doing now, not to filter results. The only isolation is the tenantId in CLI config, which selects a separate store.',
    operation: 'none',
    model: SearchMemoryInputSchema,
    run: (input): ToolV2Result => {
      async function* run(): AsyncGenerator<string, void, unknown> {
        const results = await store.search({ query: input.query, type: input.type, limit: input.limit });
        yield `${results.length} result(s)`;
        for (const hit of results) {
          yield JSON.stringify(hit);
        }
      }
      return { stdout: fromLines(run()), success: () => true };
    },
  });
}
