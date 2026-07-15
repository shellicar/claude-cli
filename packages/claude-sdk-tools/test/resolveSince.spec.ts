import { describe, expect, it } from 'vitest';
import { resolveSince } from '../src/History/resolveSince';

const NOW = new Date('2026-01-15T00:00:00.000Z');

describe('resolveSince', () => {
  it('subtracts a day span from now', () => {
    const expected = '2026-01-08T00:00:00.000Z';
    const actual = resolveSince('7d', NOW);
    expect(actual).toBe(expected);
  });

  it('subtracts a week span from now', () => {
    const expected = '2026-01-01T00:00:00.000Z';
    const actual = resolveSince('2w', NOW);
    expect(actual).toBe(expected);
  });

  it('subtracts an hour span from now', () => {
    const expected = '2026-01-14T21:00:00.000Z';
    const actual = resolveSince('3h', NOW);
    expect(actual).toBe(expected);
  });

  it('returns undefined for an unrecognised span rather than throwing', () => {
    const actual = resolveSince('yesterday', NOW);
    expect(actual).toBeUndefined();
  });

  it('returns undefined for an unknown unit', () => {
    const actual = resolveSince('5y', NOW);
    expect(actual).toBeUndefined();
  });
});
