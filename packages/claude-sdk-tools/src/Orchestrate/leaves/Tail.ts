import type { Leaf, LeafResult, Stream } from '@shellicar/orchestrate-core';

export type TailLeafInput = { count?: number };

/** Last N lines of the upstream. Deliberately NOT lazy in the way Head is — there is no way
 *  to know whether an item belongs in the final N without having seen everything after it, so
 *  this must drain the whole upstream before it can yield anything. That's inherent to what
 *  "tail" means (same as real `tail` on a non-seekable stream), not a shortcut taken here. */
export function createTailLeaf(): Leaf<TailLeafInput, string> {
  return {
    name: 'Tail',
    operation: 'none',
    run: (input, upstream): LeafResult<string> => {
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
  };
}
