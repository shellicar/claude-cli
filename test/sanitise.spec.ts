import { describe, expect, it } from 'vitest';
import { sanitiseLoneSurrogates } from '../src/sanitise.js';

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
