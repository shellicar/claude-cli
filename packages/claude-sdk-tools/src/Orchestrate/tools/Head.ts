import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { defineToolV2 } from '../defineToolV2.js';

export const HeadToolV2Model = z.object({ count: z.number().int().min(1).optional() });

/** First N lines of the upstream, then stops pulling — the tool that proves the whole
 *  streaming requirement (see the design doc and orchestrate-core's tests): a short-circuiting
 *  consumer here must cut an expensive or unbounded producer short, not force it to finish. */
export function createHeadToolV2() {
  return defineToolV2({
    name: 'Head',
    readsUpstream: true,
    description: 'First N of the piped stream. Stage.',
    operation: 'none',
    model: HeadToolV2Model,
    run: (input, upstream): ToolV2Result<string> => {
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
          // have pulled one item too many, the exact bug the design doc's Program tool tests
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
  });
}
