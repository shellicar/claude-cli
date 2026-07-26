import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { defineToolV2 } from '../defineToolV2.js';

export const TailToolV2Model = z.object({ count: z.number().int().min(1).optional() });

/** Last N lines of the upstream. Deliberately NOT lazy in the way Head is — there is no way
 *  to know whether an item belongs in the final N without having seen everything after it, so
 *  this must drain the whole upstream before it can yield anything. That's inherent to what
 *  "tail" means (same as real `tail` on a non-seekable stream), not a shortcut taken here. */
export function createTailToolV2() {
  return defineToolV2({
    name: 'Tail',
    description: 'Last N of the piped stream. Stage.',
    operation: 'none',
    model: TailToolV2Model,
    run: (input, upstream): ToolV2Result<string> => {
      const count = input.count ?? 10;

      async function* takeLast(): Stream<string> {
        if (upstream == null) {
          return;
        }
        const window: string[] = [];
        for await (const value of upstream) {
          window.push(String(value));
          if (window.length > count) {
            window.shift();
          }
        }
        for (const value of window) {
          yield value;
        }
      }

      return { stdout: takeLast(), success: () => true };
    },
  });
}
