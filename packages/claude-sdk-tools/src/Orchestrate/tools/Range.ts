import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { defineToolV2 } from '../defineToolV2.js';

export const RangeToolV2Model = z
  .object({
    start: z.number().int().min(1).describe('1-based start position (inclusive)'),
    end: z.number().int().min(1).describe('1-based end position (inclusive)'),
  })
  .refine((v) => v.start <= v.end, { message: 'Range start must not be after end', path: ['start'] });

/** A 1-based inclusive window [start, end] of the upstream. Lazy in both directions: items
 *  before `start` are skipped without being buffered, and pulling stops the instant the item
 *  at `end` is yielded — same "no extra pull" discipline as Head, for the same reason. */
export function createRangeToolV2() {
  return defineToolV2({
    name: 'Range',
    readsUpstream: true,
    description: 'A 1-based inclusive window of the piped stream. Stage.',
    operation: 'none',
    model: RangeToolV2Model,
    run: (input, upstream): ToolV2Result<string> => {
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
  });
}
