import type { Ended, Operation, Reader, Running, Writer } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { defineToolV2 } from '../defineToolV2.js';
import { NEWLINE, readLines } from '../lines.js';

/** What `head` itself takes when you do not say. */
const DEFAULT_COUNT = 10;

export const HeadModel = z.object({
  count: z.number().int().min(1).optional().describe(`How many lines to take. Defaults to ${DEFAULT_COUNT}.`),
});

type HeadInput = z.infer<typeof HeadModel>;

/** At most N lines, and they are the first ones. Stops reading once it has them, which is what makes
 *  `Find | Head 3` cheap: the engine kills a producer whose reader has gone, and this is what makes
 *  it go. */
export function createHeadTool() {
  return defineToolV2({
    name: 'Head',
    description: 'The first N lines of what is piped in. Stops reading once it has them.',
    model: HeadModel,
    operations: (): Operation[] => ['none'],

    run: (raw: Record<string, unknown>, upstream: Reader | undefined, out: Writer): Running => {
      const count = (raw as HeadInput).count ?? DEFAULT_COUNT;

      const reading = (async () => {
        if (upstream == null) {
          return;
        }
        let taken = 0;
        for await (const line of readLines(upstream)) {
          // Not accepted means whoever reads this has gone, so there is no one left to take the
          // rest for.
          if (!(await out.write(Buffer.from(`${line}${NEWLINE}`, 'utf8')))) {
            return;
          }
          taken++;
          if (taken >= count) {
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
