import { describe, expect, it } from 'vitest';
import { parseRetryAfter } from '../src/private/http/errors.js';

// ---------------------------------------------------------------------------
// parseRetryAfter — header parsing into milliseconds
// ---------------------------------------------------------------------------

describe('parseRetryAfter', () => {
  it('reads retry-after-ms as milliseconds', () => {
    const expected = 1500;

    const actual = parseRetryAfter(new Headers({ 'retry-after-ms': '1500' }));

    expect(actual).toBe(expected);
  });

  it('reads retry-after integer seconds as milliseconds', () => {
    const expected = 5000;

    const actual = parseRetryAfter(new Headers({ 'retry-after': '5' }));

    expect(actual).toBe(expected);
  });

  it('prefers retry-after-ms over retry-after when both are present', () => {
    const expected = 2000;

    const actual = parseRetryAfter(new Headers({ 'retry-after-ms': '2000', 'retry-after': '60' }));

    expect(actual).toBe(expected);
  });

  it('reads an HTTP-date retry-after as a positive forward delta', () => {
    const future = new Date(Date.now() + 30_000).toUTCString();

    const actual = parseRetryAfter(new Headers({ 'retry-after': future }));

    expect(actual).toBeGreaterThan(25_000);
  });

  it('returns undefined when neither header is present', () => {
    const expected = undefined;

    const actual = parseRetryAfter(new Headers());

    expect(actual).toBe(expected);
  });
});
