import type { Ended, Operation, Reader, Running, Writer } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { defineToolV2 } from '../defineToolV2.js';
import { NEWLINE, readLines } from '../lines.js';

/** What `tail` itself takes when you do not say. */
const DEFAULT_COUNT = 10;

export const TailModel = z.object({
  count: z.number().int().min(1).optional().describe(`How many lines to take. Defaults to ${DEFAULT_COUNT}.`),
});

type TailInput = z.infer<typeof TailModel>;

/** At most N lines, and they are the last ones. Which lines those are is not knowable until there
 *  are no more, so unlike Head it has nothing to stop early for. */
export function createTailTool() {
  return defineToolV2({
    name: 'Tail',
    description: 'The last N lines of what is piped in.',
    model: TailModel,
    operations: (): Operation[] => ['none'],

    run: (raw: Record<string, unknown>, upstream: Reader | undefined, out: Writer): Running => {
      const count = (raw as TailInput).count ?? DEFAULT_COUNT;

      const reading = (async () => {
        if (upstream == null) {
          return;
        }
        const held: string[] = [];
        for await (const line of readLines(upstream)) {
          held.push(line);
          if (held.length > count) {
            held.shift();
          }
        }
        for (const line of held) {
          if (!(await out.write(Buffer.from(`${line}${NEWLINE}`, 'utf8')))) {
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
