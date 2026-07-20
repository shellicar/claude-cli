import { describe, expect, it } from 'vitest';
import { markdownContentLines } from '../src/model/markdown/markdownLayout.js';

/**
 * Instrumentation, not a stopwatch: renderConversation's active (streaming) block is never cached
 * (see renderBlockContentCached's doc comment), and the markdown path re-lexes and re-decorates the
 * *entire* accumulated content on every delta — including code fences that finished arriving frames
 * ago. That makes total decorator work O(n^2) in the response length instead of O(n): each of the n
 * delta frames reprocesses all content received so far.
 *
 * A wall-clock benchmark would be flaky under CI load. Instead this counts the characters actually
 * handed to `decorate` across a simulated stream — a deterministic measure of redundant work — and
 * compares it against the final content length. If the active block were cached and only the new
 * tail were decorated per frame, total decorated characters would track the final length (a small
 * constant multiple, one full pass). Because nothing is cached, it scales with the number of frames
 * instead.
 */
describe('markdownContentLines — streaming re-decoration cost', () => {
  it('decorates far more total code-fence characters than the final content length when called once per delta frame', () => {
    const codeLine = 'const value = computeSomething(argumentOne, argumentTwo);\n';
    const totalLines = 40;
    const fullFence = `\`\`\`ts\n${codeLine.repeat(totalLines)}\`\`\``;

    let decoratedChars = 0;
    const countingDecorate = (code: string, lang: string): string[] => {
      decoratedChars += code.length;
      return code.split('\n');
    };

    // Simulate the streaming path: one call to markdownContentLines per delta frame, each time with
    // the cumulative content so far — exactly what renderConversation does for the uncached active block.
    for (let line = 1; line <= totalLines; line++) {
      const partialFence = `\`\`\`ts\n${codeLine.repeat(line)}\`\`\``;
      markdownContentLines(partialFence, 80, '   ', countingDecorate);
    }

    const finalContentLength = fullFence.length;
    const actual = decoratedChars > finalContentLength * 5;
    expect(actual).toBe(true);
  });

  it('would decorate only the final content once if the active block were cached (regression guard)', () => {
    const codeLine = 'const value = computeSomething(argumentOne, argumentTwo);\n';
    const totalLines = 40;
    const fullFence = `\`\`\`ts\n${codeLine.repeat(totalLines)}\`\`\``;

    let decoratedChars = 0;
    const countingDecorate = (code: string, lang: string): string[] => {
      decoratedChars += code.length;
      return code.split('\n');
    };

    // A single, final-frame render — what a cached active block would cost once streaming ends.
    markdownContentLines(fullFence, 80, '   ', countingDecorate);

    // marked's code token strips the fence's own trailing newline, so the expected length comes from
    // what the token actually carries, not from subtracting the fence markers by hand.
    const expected = codeLine.repeat(totalLines).length - 1;
    const actual = decoratedChars;
    expect(actual).toBe(expected);
  });
});
