import { sanitiseLoneSurrogates, sanitiseZwj } from '@shellicar/claude-core/sanitise';
import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';

describe('sanitiseLoneSurrogates', () => {
  it('replaces lone high surrogate', () => {
    const actual = sanitiseLoneSurrogates('hello \uD83C world');
    const expected = 'hello \uFFFD world';
    expect(actual).toBe(expected);
  });

  it('replaces lone low surrogate', () => {
    const actual = sanitiseLoneSurrogates('hello \uDF4C world');
    const expected = 'hello \uFFFD world';
    expect(actual).toBe(expected);
  });

  it('preserves valid surrogate pair', () => {
    const actual = sanitiseLoneSurrogates('hello \uD83C\uDF4C world');
    const expected = 'hello \uD83C\uDF4C world';
    expect(actual).toBe(expected);
  });

  it('replaces lone high surrogate but preserves valid pair', () => {
    const actual = sanitiseLoneSurrogates('\uD83C\uDF4C test \uD83C');
    const expected = '\uD83C\uDF4C test \uFFFD';
    expect(actual).toBe(expected);
  });
});

// Bug: string-width treats ZWJ sequences as composed (width 2),
// but terminals render them as individual emojis (4 x 2 = 8 cells).
// This mismatch causes wrong line height and cursor position.
describe('sanitiseZwj', () => {
  it('raw ZWJ sequence: stringWidth returns 2 not 8, exposing the terminal mismatch', () => {
    const familyEmoji = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';

    const actual = stringWidth(familyEmoji);

    expect(actual).toBe(2);
  });

  it('strips ZWJ characters from a compound emoji sequence', () => {
    const input = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
    const expected = '\u{1F468}\u{1F469}\u{1F467}\u{1F466}';

    const actual = sanitiseZwj(input);

    expect(actual).toBe(expected);
  });

  it('stringWidth of sanitised sequence equals sum of individual emoji widths', () => {
    const input = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
    const expected = 8; // 4 emojis x 2 cells each

    const actual = stringWidth(sanitiseZwj(input));

    expect(actual).toBe(expected);
  });

  it('leaves text without ZWJ unchanged', () => {
    const input = 'hello world';

    const actual = sanitiseZwj(input);

    expect(actual).toBe(input);
  });
});
