import type { Ended, Operation, Reader, Running, Writer } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { regexPattern } from '../../regexPattern.js';
import { defineToolV2 } from '../defineToolV2.js';
import { NEWLINE, readLines } from '../lines.js';

export const MatchModel = z.object({
  pattern: regexPattern('Keep matching lines', ['TODO', '(?<name>\\w+)']),
  caseInsensitive: z.boolean().optional(),
  before: z.number().int().min(0).optional().describe('How many lines before each match to keep as well.'),
  after: z.number().int().min(0).optional().describe('How many lines after each match to keep as well.'),
});

type MatchInput = z.infer<typeof MatchModel>;

type Line = { at: number; text: string };

/** The lines that match, in the order they arrived. Reaches the end of the stream, because the line
 *  that matches may be the last one. */
export function createMatchTool() {
  return defineToolV2({
    name: 'Match',
    description: 'Keep the lines of what is piped in that match a pattern, optionally with the lines around them.',
    model: MatchModel,
    operations: (): Operation[] => ['none'],

    run: (raw: Record<string, unknown>, upstream: Reader | undefined, out: Writer): Running => {
      const input = raw as MatchInput;
      const pattern = new RegExp(input.pattern, input.caseInsensitive === true ? 'i' : '');
      const before = input.before ?? 0;
      const after = input.after ?? 0;

      const reading = (async () => {
        if (upstream == null) {
          return;
        }
        // The lines held back in case a match arrives that wants them, and how far the last match
        // reached. A line is either inside that reach or held back, never both, which is what keeps
        // a line two matches both claim from being written twice.
        const held: Line[] = [];
        let reaches = -1;
        let at = 0;

        const write = (line: Line): Promise<boolean> => out.write(Buffer.from(`${line.text}${NEWLINE}`, 'utf8'));

        for await (const text of readLines(upstream)) {
          const line: Line = { at: at++, text };

          if (pattern.test(text)) {
            for (const earlier of held) {
              if (!(await write(earlier))) {
                return;
              }
            }
            held.length = 0;
            if (!(await write(line))) {
              return;
            }
            reaches = Math.max(reaches, line.at + after);
            continue;
          }

          if (line.at <= reaches) {
            if (!(await write(line))) {
              return;
            }
            continue;
          }

          held.push(line);
          if (held.length > before) {
            held.shift();
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
