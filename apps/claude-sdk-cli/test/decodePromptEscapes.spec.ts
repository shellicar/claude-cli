import { describe, expect, it } from 'vitest';
import { decodePromptEscapes } from '../src/decodePromptEscapes.js';

describe('decodePromptEscapes', () => {
  it('decodes \\n to LF', () => {
    const expected = 'a\nb';
    const actual = decodePromptEscapes('a\\nb');
    expect(actual).toBe(expected);
  });

  it('decodes \\r to CR', () => {
    const expected = 'a\rb';
    const actual = decodePromptEscapes('a\\rb');
    expect(actual).toBe(expected);
  });

  it('decodes \\t to tab', () => {
    const expected = 'a\tb';
    const actual = decodePromptEscapes('a\\tb');
    expect(actual).toBe(expected);
  });

  it('decodes \\\\ to a single backslash', () => {
    const expected = 'a\\b';
    const actual = decodePromptEscapes('a\\\\b');
    expect(actual).toBe(expected);
  });

  it('preserves \\\\n as literal backslash + n (not LF)', () => {
    const expected = 'a\\nb';
    const actual = decodePromptEscapes('a\\\\nb');
    expect(actual).toBe(expected);
  });

  it('preserves unknown escapes as-is', () => {
    const expected = 'a\\qb';
    const actual = decodePromptEscapes('a\\qb');
    expect(actual).toBe(expected);
  });

  it('returns input unchanged when no escapes present', () => {
    const expected = 'plain text';
    const actual = decodePromptEscapes('plain text');
    expect(actual).toBe(expected);
  });
});
