import type { Leaf, LeafResult, Stream } from '@shellicar/orchestrate-core';

export type MatchLeafInput = {
  pattern: string;
  caseInsensitive?: boolean;
  before?: number;
  after?: number;
};

/** The Orchestrate leaf equivalent of the V1 `Match` tool — but without the `input.kind`
 *  branch V1 has (`Match.ts`: `if (input.kind === 'files') ... else ...`). In the plain-text
 *  world every leaf just emits strings, so there's no `kind` left to branch on: this tests
 *  every incoming string against the pattern uniformly, exactly like real `grep` does,
 *  regardless of whether the caller piped in paths or content. That's not a simplification —
 *  it's what removes the polymorphism the design doc flagged as the actual problem with V1's
 *  `Match`. `before`/`after` use a bounded sliding window (size `before`, plus tracking one
 *  active after-window boundary) instead of V1's whole-array `collectMatchedIndices`, so a
 *  short-circuiting consumer downstream still doesn't force the whole stream to materialize. */
export function createMatchLeaf(): Leaf<MatchLeafInput, string> {
  return {
    name: 'Match',
    operation: 'none',
    run: (input, upstream): LeafResult<string> => {
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
  };
}
