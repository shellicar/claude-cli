import type { ToolV2Result } from '@shellicar/orchestrate-core';
import { fromLines } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import type { RefStore } from '../../RefStore/RefStore.js';
import { defineToolV2 } from '../defineToolV2.js';

export const RefToolV2Model = z.object({
  id: z.string().describe('The ref ID returned in a { ref, size, hint } token.'),
  start: z.number().int().min(0).default(0).describe('Start character offset (inclusive). Default 0.'),
  limit: z.number().int().min(1).max(100_000).default(10_000).describe('Maximum number of characters to return. Max 100000, default 10000. Use start+limit to page through large refs.'),
});

/** The V2 tool equivalent of V1's `Ref` \u2014 same character-range paging (`start`/`limit`), but
 *  emits its slice split into lines instead of one JSON blob, so it composes directly with
 *  `Match`/`Head`/`Tail`/`Range` (`Ref | Match` filters a huge stored ref without ever pulling
 *  the whole thing into context first). `id` names no path \u2014 it addresses the same in-memory
 *  `RefStore` V1's automatic ref-swap (`transformToolResult`) already writes to, so a ref
 *  produced by any tool's oversized output is fetchable here. `none` tier: an in-memory
 *  lookup, not a filesystem or process operation. */
export function createRefToolV2(store: RefStore) {
  return defineToolV2({
    name: 'Ref',
    description: 'Fetch the content of a stored ref, split into lines. When a tool result contains { ref, size, hint } instead of the full value, use this tool to retrieve it \u2014 pipe into Match/Head/Tail/Range to filter without pulling the whole thing into context.',
    operation: 'none',
    model: RefToolV2Model,
    run: (input, _upstream, stderr): ToolV2Result => {
      let ok = true;

      async function* run(): AsyncGenerator<string, void, unknown> {
        const slice = store.getSlice(input.id, input.start, input.limit);
        if (slice === undefined) {
          ok = false;
          stderr.push(`Ref not found: ${input.id}`);
          return;
        }
        for (const line of slice.content.split('\n')) {
          yield line;
        }
      }

      return { stdout: fromLines(run()), success: () => ok };
    },
  });
}
