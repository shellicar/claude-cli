import { describe, expect, it } from 'vitest';
import { parseModelName } from '../src/view/parseModelName.js';

describe('parseModelName — name', () => {
  it('extracts Sonnet from claude-sonnet-4-6', () => {
    const expected = 'Sonnet';
    const actual = parseModelName('claude-sonnet-4-6').name;
    expect(actual).toBe(expected);
  });

  it('extracts Opus from claude-opus', () => {
    const expected = 'Opus';
    const actual = parseModelName('claude-opus').name;
    expect(actual).toBe(expected);
  });

  it('extracts Mrmagoo from claude-mrmagoo-4', () => {
    const expected = 'Mrmagoo';
    const actual = parseModelName('claude-mrmagoo-4').name;
    expect(actual).toBe(expected);
  });

  it('extracts Mrmagoo from claude-mrmagoo', () => {
    const expected = 'Mrmagoo';
    const actual = parseModelName('claude-mrmagoo').name;
    expect(actual).toBe(expected);
  });
});

describe('parseModelName — version', () => {
  it('joins trailing numerics with a dot from claude-sonnet-4-6', () => {
    const expected = '4.6';
    const actual = parseModelName('claude-sonnet-4-6').version;
    expect(actual).toBe(expected);
  });

  it('returns null when no trailing numerics in claude-opus', () => {
    const expected = null;
    const actual = parseModelName('claude-opus').version;
    expect(actual).toBe(expected);
  });

  it('returns the single trailing numeric from claude-mrmagoo-4', () => {
    const expected = '4';
    const actual = parseModelName('claude-mrmagoo-4').version;
    expect(actual).toBe(expected);
  });

  it('returns null when no trailing numerics in claude-mrmagoo', () => {
    const expected = null;
    const actual = parseModelName('claude-mrmagoo').version;
    expect(actual).toBe(expected);
  });
});
