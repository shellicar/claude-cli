export const BASE_DELAY_MS = 500;
export const MAX_DELAY_MS = 32_000;
export const MAX_RETRIES = 10;
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
export function isRetryable(_error: unknown): boolean {
  throw new Error('not implemented');
}

/**
 * A 429 whose retry-after exceeds the cap: the non-transient account-limit case.
 * A 429 with no retry-after, or one within the cap, is transient and handled by
 * the normal backoff path (isRetryable).
 */
export function isAccountLimit(_error: unknown, _capMs: number): boolean {
  throw new Error('not implemented');
}

type ScheduleTimer = (ms: number, onExpiry: () => void) => () => void;

function defaultTimer(ms: number, onExpiry: () => void): () => void {
  const handle = setTimeout(onExpiry, ms);
  return () => clearTimeout(handle);
}

/**
 * Sleeps for `ms` milliseconds. Resolves immediately if the signal is already
 * aborted or fires before the delay elapses, so Ctrl-C during a long backoff
 * cancels at once rather than waiting out the full sleep.
 */
export function defaultSleep(ms: number, signal: AbortSignal, schedule: ScheduleTimer = defaultTimer): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const cancel = schedule(ms, resolve);
    signal.addEventListener(
      'abort',
      () => {
        cancel();
        resolve();
      },
      { once: true },
    );
  });
}
