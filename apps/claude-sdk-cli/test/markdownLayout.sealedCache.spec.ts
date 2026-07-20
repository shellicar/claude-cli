import { describe, expect, it } from 'vitest';
import { renderTokenLines, splitSealedTokens } from '../src/model/markdown/markdownLayout.js';

/**
 * Proves the fix behind renderStreamingMarkdown (renderConversation.ts): splitting lexed tokens at the
 * last top-level `space` token and caching the sealed half turns a streaming response with completed
 * paragraphs ahead of the writing cursor back into near-linear decorator cost, instead of the O(n^2)
 * cost markdownLayout.perf.spec.ts documents for markdownContentLines called on the whole accumulated
 * content every frame.
 *
 * This exercises the exported primitives directly (splitSealedTokens / renderTokenLines) with the same
 * sealed-cache shape renderStreamingMarkdown uses, rather than re-testing renderConversation end to end —
 * cli-highlight isn't injectable there, but the caching contract lives entirely in these two functions.
 */
describe('splitSealedTokens + renderTokenLines — sealed/tail caching', () => {
  function simulateStream(frames: readonly string[]): { decoratedChars: number; finalLines: string[] } {
    let decoratedChars = 0;
    const countingDecorate = (code: string, _lang: string): string[] => {
      decoratedChars += code.length;
      return code.split('\n');
    };

    let cache: { sealedRaw: string; sealedLines: string[] } | undefined;
    let finalLines: string[] = [];
    for (const content of frames) {
      const { sealed, tail } = splitSealedTokens(content);
      const sealedRaw = sealed.map((t) => t.raw ?? '').join('');
      let sealedLines: string[];
      if (cache && cache.sealedRaw === sealedRaw) {
        sealedLines = cache.sealedLines;
      } else {
        sealedLines = renderTokenLines(sealed, 80, '', countingDecorate);
        cache = { sealedRaw, sealedLines };
      }
      const tailLines = renderTokenLines(tail, 80, '', countingDecorate);
      finalLines = [...sealedLines, ...tailLines];
    }
    return { decoratedChars, finalLines };
  }

  it('does not re-decorate a fence once a blank line and further paragraph text seals it', () => {
    const fence = '```ts\nconst x = computeSomething(argumentOne, argumentTwo);\n```';
    const frames: string[] = [];
    // The fence streams in, then closes, then a blank line and a growing new paragraph follow —
    // each new paragraph character is its own frame, simulating one delta per character.
    const tail = '\n\nAnd then a following paragraph grows word by word here';
    for (let i = 1; i <= tail.length; i++) {
      frames.push(fence + tail.slice(0, i));
    }

    const { decoratedChars } = simulateStream(frames);

    // The fence body is decorated a small, bounded number of times (once while still part of the
    // growing tail just before the blank line fully forms, once more when first cached as sealed) —
    // not once per subsequent frame across the ~55-character tail that follows it. Bounded at a small
    // constant multiple, not proportional to the number of later frames, is the actual fix.
    const fenceBodyLength = 'const x = computeSomething(argumentOne, argumentTwo);'.length;
    const actual = decoratedChars <= fenceBodyLength * 3;
    expect(actual).toBe(true);
  });

  it('does not scale with the number of frames after the fence is sealed', () => {
    const fence = '```ts\nconst x = computeSomething(argumentOne, argumentTwo);\n```';
    const shortTail = '\n\nshort';
    const longTail = `\n\n${'a following paragraph that keeps growing and growing and growing '.repeat(10)}`;

    const shortFrames: string[] = [];
    for (let i = 1; i <= shortTail.length; i++) {
      shortFrames.push(fence + shortTail.slice(0, i));
    }
    const longFrames: string[] = [];
    for (let i = 1; i <= longTail.length; i++) {
      longFrames.push(fence + longTail.slice(0, i));
    }

    const fenceOnlyCost = simulateStream(shortFrames).decoratedChars;
    const withManyMoreFramesCost = simulateStream(longFrames).decoratedChars;

    // `decorate` only ever runs on `code` (fence) tokens — plain paragraph text never reaches it — so
    // decoratedChars measures the fence's re-decoration cost specifically. The paragraph tail itself is
    // still fully re-rendered every frame by design (it's the still-open, non-monotonic part — see
    // markdownLayout.streaming-corruption.spec.ts), just not through this counter. What must NOT grow
    // is the fence's contribution: it should cost the same whether ten more frames of trailing paragraph
    // text follow it or a thousand more.
    const actual = withManyMoreFramesCost - fenceOnlyCost < fenceOnlyCost;
    expect(actual).toBe(true);
  });

  it('still decorates a fence on every frame while it has not yet been sealed by a following blank line', () => {
    const codeLine = 'const value = 1;\n';
    const totalLines = 10;
    const frames: string[] = [];
    for (let line = 1; line <= totalLines; line++) {
      frames.push(`\`\`\`ts\n${codeLine.repeat(line)}\`\`\``);
    }

    const { decoratedChars } = simulateStream(frames);

    // No blank line ever follows this still-open fence across any frame, so every frame's fence body
    // falls in the tail and gets re-decorated — same O(n^2) shape as the unfixed path for this case.
    const finalBodyLength = codeLine.repeat(totalLines).length - 1;
    const actual = decoratedChars > finalBodyLength * 5;
    expect(actual).toBe(true);
  });

  it('produces the same final rendered lines as a single non-streamed render', () => {
    const content = '```ts\nconst x = 1;\n```\n\nAnd a following paragraph.';
    const frames: string[] = [];
    for (let i = 1; i <= content.length; i++) {
      frames.push(content.slice(0, i));
    }
    const plainDecorate = (code: string): string[] => code.split('\n');

    const { finalLines } = simulateStream(frames);
    const expected = renderTokenLines(splitSealedTokens(content).sealed.concat(splitSealedTokens(content).tail), 80, '', plainDecorate);
    const actual = finalLines;
    expect(actual).toEqual(expected);
  });
});
