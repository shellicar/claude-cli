import type { Stream, ToolV2Result } from '@shellicar/orchestrate-core';
import { z } from 'zod';
import { regexPattern } from '../../regexPattern.js';
import { defineToolV2 } from '../defineToolV2.js';

export const MatchToolV2Model = z.object({
  pattern: regexPattern('Keep matching lines', ['TODO', '(?<name>\\w+)']),
  caseInsensitive: z.boolean().optional(),
  before: z.number().int().min(0).optional(),
  after: z.number().int().min(0).optional(),
});

/** The V2 tool equivalent of V1's `Match` — but without the `input.kind` branch V1 has
 *  (`Match.ts`: `if (input.kind === 'files') ... else ...`). In the plain-text world every
 *  tool just emits strings, so there's no `kind` left to branch on: this tests every incoming
 *  string against the pattern uniformly, exactly like real `grep` does, regardless of whether
 *  the caller piped in paths or content. That's not a simplification — it's what removes the
 *  polymorphism the design doc flagged as the actual problem with V1's `Match`. */
export function createMatchToolV2() {
  return defineToolV2({
    name: 'Match',
    description: 'Keep matching lines from the piped stream. Stage.',
    operation: 'none',
    model: MatchToolV2Model,
    run: (input, upstream): ToolV2Result<string> => {
      const re = new RegExp(input.pattern, input.caseInsensitive ? 'i' : '');
      const before = input.before ?? 0;
      const after = input.after ?? 0;

      async function* filter(): Stream<string> {
        if (upstream == null) {
          return;
        }

        type Buffered = { lineNo: number; text: string };
        const beforeBuffer: Buffered[] = [];
        let windowEnd = -1;
        let lastEmittedLineNo = -1;
        let lineNo = 0;

        for await (const value of upstream) {
          const text = String(value);
          const currentLineNo = lineNo;
          lineNo++;

          if (re.test(text)) {
            for (const buffered of beforeBuffer) {
              if (buffered.lineNo > lastEmittedLineNo) {
                yield buffered.text;
                lastEmittedLineNo = buffered.lineNo;
              }
            }
            if (currentLineNo > lastEmittedLineNo) {
              yield text;
              lastEmittedLineNo = currentLineNo;
            }
            windowEnd = Math.max(windowEnd, currentLineNo + after);
            beforeBuffer.length = 0;
          } else if (currentLineNo <= windowEnd) {
            yield text;
            lastEmittedLineNo = currentLineNo;
          } else {
            beforeBuffer.push({ lineNo: currentLineNo, text });
            if (beforeBuffer.length > before) {
              beforeBuffer.shift();
            }
          }
        }
      }

      return { stdout: filter(), success: () => true };
    },
  });
}
