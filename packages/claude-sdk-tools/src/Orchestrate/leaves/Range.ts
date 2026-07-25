import type { Leaf, LeafResult, Stream } from '@shellicar/orchestrate-core';

export type RangeLeafInput = { start: number; end: number };

/** A 1-based inclusive window [start, end] of the upstream. Lazy in both directions: items
 *  before `start` are skipped without being buffered, and pulling stops the instant the item
 *  at `end` is yielded — same "no extra pull" discipline as Head, for the same reason. */
export function createRangeLeaf(): Leaf<RangeLeafInput, string> {
  return {
    name: 'Range',
    operation: 'none',
    run: (input, upstream): LeafResult<string> => {
      const { start, end } = input;

      async function* window(): Stream<string> {
        if (upstream == null) {
          return;
        }
        let pos = 0;
        for await (const value of upstream) {
          pos++;
          if (pos < start) {
            continue;
          }
          yield String(value);
          if (pos >= end) {
            if ('return' in upstream) {
              await upstream.return(undefined);
            }
            return;
          }
        }
      }

      return { stdout: window(), success: () => true };
    },
  };
}
