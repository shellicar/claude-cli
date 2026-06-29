import { describe, expect, it } from 'vitest';
import { toFtsMatch } from '../src/memory/search';

describe('toFtsMatch', () => {
  it('quotes each word and OR-joins', () => {
    const expected = '"hello" OR "world"';

    const actual = toFtsMatch('hello world');

    expect(actual).toBe(expected);
  });

  it('drops operator punctuation, keeping only words', () => {
    const expected = '"hello" OR "world"';

    const actual = toFtsMatch('hello -world');

    expect(actual).toBe(expected);
  });

  it('returns null when no usable token remains', () => {
    const actual = toFtsMatch('-');

    expect(actual).toBeNull();
  });
});
