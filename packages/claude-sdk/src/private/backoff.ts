import { APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';

export const BASE_DELAY_MS = 500;
export const MAX_DELAY_MS = 32_000;
export const MAX_RETRIES = 10;

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
 * Returns true for errors worth retrying (transient capacity and connection
 * failures). Returns false for permanent errors and user aborts.
 *
 * Retryable:
 *   - APIConnectionError (and APIConnectionTimeoutError, which extends it)
 *   - APIError with type 'rate_limit_error' or 'overloaded_error'
 *     (covers both in-stream HTTP-200 and HTTP-529 variants)
 *
 * Pass through:
 *   - APIUserAbortError (user intended the cancel)
 *   - Any other APIError (invalid_request_error, not_found_error, etc.)
 *   - Plain Error and non-Error values
 */
export function isRetryable(error: unknown): boolean {
  // User abort: always pass through, never retry.
  if (error instanceof APIUserAbortError) {
    return false;
  }

  // Connection failures and timeouts: retry.
  // APIConnectionTimeoutError extends APIConnectionError — one check covers both.
  if (error instanceof APIConnectionError) {
    return true;
  }

  // In-stream and HTTP-level typed errors: retry rate-limit and overload only.
  if (error instanceof APIError) {
    const t = error.type;
    return t === 'rate_limit_error' || t === 'overloaded_error';
  }

  return false;
}

/**
 * Sleeps for `ms` milliseconds. Resolves immediately if the signal is already
 * aborted or fires before the delay elapses, so Ctrl-C during a long backoff
 * cancels at once rather than waiting out the full sleep.
 */
export function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
