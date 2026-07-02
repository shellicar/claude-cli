import { ApiStreamError, ConnectionError, HttpError } from './http/errors';

export const BASE_DELAY_MS = 500;
export const MAX_DELAY_MS = 32_000;
export const MAX_RETRIES = 10;
/** Stream-interrupt retry: a dropped socket recovers on network-return time, not
 * server-recovery time, so a short fixed delay beats exponential backoff. SC's
 * starting points — adjust here. */
export const STREAM_INTERRUPT_MAX_RETRIES = 2;
export const STREAM_INTERRUPT_DELAY_MS = 30_000;
/** v1: every honoured retry-after is capped at this. A 429 whose retry-after
 * exceeds the cap is the non-transient "account limit" case. */
export const RETRY_AFTER_CAP_MS = 60_000;
/** v1: a floor of 10 minutes of 429s before give-up. */
export const ACCOUNT_LIMIT_BUDGET_MS = 600_000;

/**
 * Computes the backoff delay for attempt n (1-based).
 * base = min(BASE_DELAY_MS * 2^(n-1), MAX_DELAY_MS)
 * delay = base + random() * 0.5 * base   (jitter in [0, 0.5 * base])
 *
 * Pre-jitter schedule for attempts 1-10 (random = 0):
 * 500, 1000, 2000, 4000, 8000, 16000, 32000, 32000, 32000, 32000 ms
 */
export function calculateBackoffDelay(attempt: number, random: () => number): number {
  const base = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return base + random() * 0.5 * base;
}

/**
 * Returns true for errors worth retrying. Returns false for errors that
 * should pass through unchanged.
 *
 * Transient conditions retry: connection failures, timeouts, and
 * capacity/rate-limit errors.
 *
 * User aborts and permanent client errors pass through.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ConnectionError) {
    return true; // TimeoutError extends ConnectionError — one check covers both.
  }
  if (error instanceof HttpError) {
    return error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
  }
  if (error instanceof ApiStreamError) {
    const t = error.type;
    return t === 'rate_limit_error' || t === 'overloaded_error' || t === 'timeout_error' || t === 'api_error';
  }
  return false;
}

/**
 * A 429 whose retry-after exceeds the cap: the non-transient account-limit case.
 * A 429 with no retry-after, or one within the cap, is transient and handled by
 * the normal backoff path (isRetryable).
 */
export function isAccountLimit(error: unknown, capMs: number): boolean {
  return error instanceof HttpError && error.status === 429 && error.retryAfterMs != null && error.retryAfterMs > capMs;
}
