import { describe, expect, it } from 'vitest';
import { BASE_DELAY_MS, calculateBackoffDelay, defaultSleep, isAccountLimit, isRetryable, MAX_DELAY_MS, RETRY_AFTER_CAP_MS } from '../src/private/backoff.js';
import { ApiStreamError, ConnectionError, HttpError, TimeoutError } from '../src/private/http/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpError(status: number, retryAfterMs?: number): HttpError {
  return new HttpError(status, retryAfterMs, undefined, new Headers());
}

// ---------------------------------------------------------------------------
// calculateBackoffDelay (unchanged behaviour)
// ---------------------------------------------------------------------------

describe('calculateBackoffDelay', () => {
  it('attempt 1 with random=0 returns BASE_DELAY_MS', () => {
    const expected = BASE_DELAY_MS;
    const actual = calculateBackoffDelay(1, () => 0);
    expect(actual).toBe(expected);
  });

  it('attempt 1 with random=1 returns 1.5 * BASE_DELAY_MS', () => {
    const expected = BASE_DELAY_MS * 1.5;
    const actual = calculateBackoffDelay(1, () => 1);
    expect(actual).toBe(expected);
  });

  it('attempt 2 with random=0 doubles the base from attempt 1', () => {
    const expected = BASE_DELAY_MS * 2;
    const actual = calculateBackoffDelay(2, () => 0);
    expect(actual).toBe(expected);
  });

  it('attempt 7 with random=0 is capped at MAX_DELAY_MS', () => {
    const expected = MAX_DELAY_MS;
    const actual = calculateBackoffDelay(7, () => 0);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// isRetryable — owned-error classifier
// ---------------------------------------------------------------------------

describe('isRetryable', () => {
  it('returns true for ConnectionError', () => {
    const expected = true;
    const actual = isRetryable(new ConnectionError('connection failed'));
    expect(actual).toBe(expected);
  });

  it('returns true for TimeoutError (extends ConnectionError)', () => {
    const expected = true;
    const actual = isRetryable(new TimeoutError('timed out'));
    expect(actual).toBe(expected);
  });

  it('returns true for HttpError 408', () => {
    const expected = true;
    const actual = isRetryable(httpError(408));
    expect(actual).toBe(expected);
  });

  it('returns true for HttpError 409', () => {
    const expected = true;
    const actual = isRetryable(httpError(409));
    expect(actual).toBe(expected);
  });

  it('returns true for HttpError 429', () => {
    const expected = true;
    const actual = isRetryable(httpError(429));
    expect(actual).toBe(expected);
  });

  it('returns true for HttpError 500', () => {
    const expected = true;
    const actual = isRetryable(httpError(500));
    expect(actual).toBe(expected);
  });

  it('returns false for HttpError 400', () => {
    const expected = false;
    const actual = isRetryable(httpError(400));
    expect(actual).toBe(expected);
  });

  it('returns true for an ApiStreamError of a transient type', () => {
    const expected = true;
    const actual = isRetryable(new ApiStreamError('rate_limit_error', {}));
    expect(actual).toBe(expected);
  });

  it('returns false for an ApiStreamError of a permanent type', () => {
    const expected = false;
    const actual = isRetryable(new ApiStreamError('invalid_request_error', {}));
    expect(actual).toBe(expected);
  });

  it('returns false for a DOMException abort', () => {
    const expected = false;
    const actual = isRetryable(new DOMException('aborted', 'AbortError'));
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// isAccountLimit — a 429 whose retry-after exceeds the cap
// ---------------------------------------------------------------------------

describe('isAccountLimit', () => {
  it('returns true for a 429 whose retry-after exceeds the cap', () => {
    const expected = true;
    const actual = isAccountLimit(httpError(429, 90_000), RETRY_AFTER_CAP_MS);
    expect(actual).toBe(expected);
  });

  it('returns false for a 429 whose retry-after is within the cap', () => {
    const expected = false;
    const actual = isAccountLimit(httpError(429, 30_000), RETRY_AFTER_CAP_MS);
    expect(actual).toBe(expected);
  });

  it('returns false for a 429 with no retry-after', () => {
    const expected = false;
    const actual = isAccountLimit(httpError(429, undefined), RETRY_AFTER_CAP_MS);
    expect(actual).toBe(expected);
  });

  it('returns false for a non-429 with a large retry-after', () => {
    const expected = false;
    const actual = isAccountLimit(httpError(503, 90_000), RETRY_AFTER_CAP_MS);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// defaultSleep — abort-awareness (unchanged behaviour)
// ---------------------------------------------------------------------------

describe('defaultSleep', () => {
  const neverFires =
    (_ms: number, _onExpiry: () => void): (() => void) =>
    () => {};

  it('resolves when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const actual = await defaultSleep(1_000_000, controller.signal, neverFires).then(
      () => 'resolved',
      () => 'rejected',
    );
    const expected = 'resolved';

    expect(actual).toBe(expected);
  });

  it('resolves when signal fires during sleep', async () => {
    const controller = new AbortController();
    const sleeping = defaultSleep(1_000_000, controller.signal, neverFires);

    controller.abort();

    const actual = await sleeping.then(
      () => 'resolved',
      () => 'rejected',
    );
    const expected = 'resolved';

    expect(actual).toBe(expected);
  });
});
