import { marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { markdownContentLines } from '../src/model/markdown/markdownLayout.js';
import { BULLET } from '../src/model/markdown/palette.js';

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI for test assertions
const STRIP_ANSI = /\x1b\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(STRIP_ANSI, '');
}

const plainDecorate = (code: string): string[] => code.split('\n');

/**
 * These tests aren't about the O(n^2) re-decoration cost (see markdownLayout.perf.spec.ts) — they're
 * about whether re-lexing a *growing* prefix produces a rendered structure that only ever extends the
 * previous frame's structure, or whether it can flip to something structurally different frame to
 * frame. The distinction matters directly for any incremental-cache scheme (see the D discussion):
 * a scheme that assumes "everything but the last block token is final, cache it" is only safe if a
 * span already classified one way can never be reclassified once more text streams in.
 *
 * marked's block tokenizer resolves this correctly for fences (the fence rule greedily matches to
 * EOF when unclosed — see markdownLayout.perf.spec.ts / the D discussion), but not for every
 * construct. A single `*` — the opening delimiter of `**bold**` — is indistinguishable from a bullet
 * list marker until more text arrives to disambiguate it.
 */
describe('markdownContentLines — streaming reclassification hazards', () => {
  it('a lone leading asterisk (the start of `**bold**`) mid-stream renders as a bullet list marker', () => {
    const lines = markdownContentLines('*', 80, '', plainDecorate).map(stripAnsi);
    const actual = lines.some((l) => l.includes(BULLET));
    expect(actual).toBe(true);
  });

  it('once more text disambiguates it, the same leading span is no longer rendered as a list', () => {
    const lines = markdownContentLines('**Hello', 80, '', plainDecorate).map(stripAnsi);
    const actual = lines.some((l) => l.includes(BULLET));
    expect(actual).toBe(false);
  });

  it('marked lexes a lone leading asterisk as a `list` token, not a `paragraph` token', () => {
    const tokens = marked.lexer('*');
    const actual = tokens[0]?.type;
    expect(actual).toBe('list');
  });

  it('marked lexes the same leading span as a `paragraph` token once the bold marker is disambiguated', () => {
    const tokens = marked.lexer('**Hello');
    const actual = tokens[0]?.type;
    expect(actual).toBe('paragraph');
  });
});

/**
 * `**Hello *world* how are you today**` streamed one character at a time: the rendered structure does
 * not monotonically grow toward the final form. It passes through a visually distinct, arguably
 * broken-looking intermediate (a stray literal asterisk plus doubly-nested identical emphasis) one
 * character before the closing `**` arrives, then snaps to the correct nested strong/em structure only
 * once the very last character lands. A cache that treats a rendered frame as "the stable prefix of the
 * next frame" would be wrong here — the whole span has to be considered part of the still-open,
 * always-fully-re-rendered tail until the enclosing paragraph itself closes.
 */
describe('markdownContentLines — nested emphasis does not resolve monotonically while streaming', () => {
  const full = '**Hello *world* how are you today**';

  it('renders literal double asterisks while the outer bold is still unclosed', () => {
    const prefix = full.slice(0, full.length - 2); // '...today', no closing ** yet
    const lines = markdownContentLines(prefix, 80, '', plainDecorate).map(stripAnsi);
    const actual = lines.some((l) => l.includes('**Hello'));
    expect(actual).toBe(true);
  });

  it('one character later (closing only the inner emphasis marker), the render is not the previous frame plus one character', () => {
    const oneShort = full.slice(0, full.length - 1); // '...today*'
    const previous = markdownContentLines(full.slice(0, full.length - 2), 80, '', plainDecorate).map(stripAnsi).join('\n');
    const current = markdownContentLines(oneShort, 80, '', plainDecorate).map(stripAnsi).join('\n');
    const actual = current.startsWith(previous);
    expect(actual).toBe(false);
  });

  it('the final frame (closing ** arrives) renders correctly as nested strong/em, not literal asterisks', () => {
    const lines = markdownContentLines(full, 80, '', plainDecorate).map(stripAnsi);
    const actual = lines.some((l) => l.includes('Hello world how are you today') && !l.includes('*'));
    expect(actual).toBe(true);
  });
});
