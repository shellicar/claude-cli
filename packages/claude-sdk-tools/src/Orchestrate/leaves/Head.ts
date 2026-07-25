import type { Leaf, LeafResult, Stream } from '@shellicar/orchestrate-core';

export type HeadLeafInput = { count?: number };

/** First N lines of the upstream, then stops pulling — the leaf that proves the whole
 *  streaming requirement (see the design doc and orchestrate-core's tests): a short-circuiting
 *  consumer here must cut an expensive or unbounded producer short, not force it to finish. */
export function createHeadLeaf(): Leaf<HeadLeafInput, string> {
  return {
    name: 'Head',
    operation: 'none',
    run: (input, upstream): LeafResult<string> => {
      const count = input.count ?? 10;

      async function* take(): Stream<string> {
        if (upstream == null) {
          return;
        }
        let taken = 0;
        for await (const value of upstream) {
          yield String(value);
          taken++;
          // Stop the instant the Nth item is yielded — checking after a break would already
          // have pulled one item too many, the exact bug the design doc's Program leaf tests
          // exist to catch (an over-pull that a real process would have paid real work for).
          if (taken >= count) {
            if ('return' in upstream) {
              await upstream.return(undefined);
            }
            return;
          }
        }
      }

      return { stdout: take(), success: () => true };
    },
  };
}
