import { describe, expect, it } from 'vitest';
import { SearchHistoryInputSchema } from '../src/History/schema';

// The `since` / `until` fields share one validated grammar: a relative span or an absolute calendar date, and
// nothing else. These prove the schema is the gate — a malformed bound is rejected here, before the store ever
// sees it, rather than silently widening a search the way the old loose `z.string()` did.

const accepts = (field: 'since' | 'until', value: string): boolean => SearchHistoryInputSchema.safeParse({ query: 'x', [field]: value }).success;

describe('SearchHistoryInputSchema — since accepts every valid bound', () => {
  it.each(['7d', '2w', '3m', '1y', '2026', '2026-06', '2026-06-20'])('accepts %s', (value) => {
    const expected = true;
    const actual = accepts('since', value);
    expect(actual).toBe(expected);
  });
});

describe('SearchHistoryInputSchema — since rejects a malformed bound', () => {
  it.each(['banana-o-clock', '3h', '2026-13', '2026-06-31', '', '2026-6'])('rejects %s', (value) => {
    const expected = false;
    const actual = accepts('since', value);
    expect(actual).toBe(expected);
  });
});

describe('SearchHistoryInputSchema — until shares the same grammar', () => {
  it('accepts an absolute date', () => {
    const expected = true;
    const actual = accepts('until', '2026-06');
    expect(actual).toBe(expected);
  });

  it('rejects an impossible date', () => {
    const expected = false;
    const actual = accepts('until', '2026-13');
    expect(actual).toBe(expected);
  });
});

describe('SearchHistoryInputSchema — both bounds are optional', () => {
  it('parses a query with neither bound', () => {
    const expected = true;
    const actual = SearchHistoryInputSchema.safeParse({ query: 'x' }).success;
    expect(actual).toBe(expected);
  });
});
