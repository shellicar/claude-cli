import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import type { ErrorType } from '@anthropic-ai/sdk/resources/shared.js';
import { describe, expect, it } from 'vitest';
import { BASE_DELAY_MS, calculateBackoffDelay, defaultSleep, isRetryable, MAX_DELAY_MS } from '../src/private/backoff.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApiError(type: ErrorType): APIError {
  const body = { type: 'error', error: { type } };
  return new APIError(undefined, body, undefined, new Headers(), type);
}

// ---------------------------------------------------------------------------
// calculateBackoffDelay
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

  it('attempt 3 with random=0 doubles the base from attempt 2', () => {
    const expected = BASE_DELAY_MS * 4;
    const actual = calculateBackoffDelay(3, () => 0);
    expect(actual).toBe(expected);
  });

  it('attempt 7 with random=0 is capped at MAX_DELAY_MS', () => {
    const expected = MAX_DELAY_MS;
    const actual = calculateBackoffDelay(7, () => 0);
    expect(actual).toBe(expected);
  });

  it('attempt 10 with random=0 is also capped at MAX_DELAY_MS (cap holds)', () => {
    const expected = MAX_DELAY_MS;
    const actual = calculateBackoffDelay(10, () => 0);
    expect(actual).toBe(expected);
  });

  it('jitter with random=1 gives 1.5 * base at cap', () => {
    const expected = MAX_DELAY_MS * 1.5;
    const actual = calculateBackoffDelay(7, () => 1);
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// isRetryable
// ---------------------------------------------------------------------------

describe('isRetryable', () => {
  it('returns false for APIUserAbortError', () => {
    const expected = false;
    const actual = isRetryable(new APIUserAbortError());
    expect(actual).toBe(expected);
  });

  it('returns true for APIConnectionError', () => {
    const expected = true;
    const actual = isRetryable(new APIConnectionError({ message: 'connection failed' }));
    expect(actual).toBe(expected);
  });

  it('returns true for APIConnectionTimeoutError (extends APIConnectionError)', () => {
    const expected = true;
    const actual = isRetryable(new APIConnectionTimeoutError({ message: 'timeout' }));
    expect(actual).toBe(expected);
  });

  it('returns true for rate_limit_error', () => {
    const expected = true;
    const actual = isRetryable(makeApiError('rate_limit_error'));
    expect(actual).toBe(expected);
  });

  it('returns true for overloaded_error', () => {
    const expected = true;
    const actual = isRetryable(makeApiError('overloaded_error'));
    expect(actual).toBe(expected);
  });

  it('returns true for timeout_error', () => {
    const expected = true;
    const actual = isRetryable(makeApiError('timeout_error'));
    expect(actual).toBe(expected);
  });

  it('returns false for invalid_request_error', () => {
    const expected = false;
    const actual = isRetryable(makeApiError('invalid_request_error'));
    expect(actual).toBe(expected);
  });

  it('returns false for a plain Error', () => {
    const expected = false;
    const actual = isRetryable(new Error('something went wrong'));
    expect(actual).toBe(expected);
  });

  it('returns false for non-Error values', () => {
    const expected = false;
    const actual = isRetryable('a string error');
    expect(actual).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// defaultSleep — abort-awareness
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
