import type { Ended, Operation, Reader, Running, Writer } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { defineToolV2 } from '../defineToolV2.js';
import { NEWLINE, readLines } from '../lines.js';

export const RangeModel = z
  .object({
    start: z.number().int().min(1).describe('1-based start line, inclusive.'),
    end: z.number().int().min(1).describe('1-based end line, inclusive.'),
  })
  .refine((range) => range.start <= range.end, { message: 'start must not be after end', path: ['start'] });

type RangeInput = z.infer<typeof RangeModel>;

/** The lines between the two bounds, counted from one and including both. Stops reading once past
 *  the upper bound, so a window over an expensive producer costs the window and not the whole. */
export function createRangeTool() {
  return defineToolV2({
    name: 'Range',
    description: 'The lines between two 1-based inclusive bounds of what is piped in.',
    model: RangeModel,
    operations: (): Operation[] => ['none'],

    run: (raw: Record<string, unknown>, upstream: Reader | undefined, out: Writer): Running => {
      const { start, end } = raw as RangeInput;

      const reading = (async () => {
        if (upstream == null) {
          return;
        }
        let at = 0;
        for await (const line of readLines(upstream)) {
          at++;
          if (at < start) {
            continue;
          }
          if (!(await out.write(Buffer.from(`${line}${NEWLINE}`, 'utf8')))) {
            return;
          }
          if (at >= end) {
            return;
          }
        }
      })().finally(() => out.end());

      const ended: Ended = { kind: 'finished' };
      return {
        ended: () => ended,
        stop: async () => {
          await reading;
        },
      };
    },
  });
}
