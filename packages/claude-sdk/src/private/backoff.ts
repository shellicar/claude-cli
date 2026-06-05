export const BASE_DELAY_MS = 500;
export const MAX_DELAY_MS = 32_000;
export const MAX_RETRIES = 10;

export function calculateBackoffDelay(_attempt: number, _random: () => number): number {
  return 0; // stub — tests will fail
}

export function isRetryable(_error: unknown): boolean {
  return false; // stub — tests will fail
}

export function defaultSleep(ms: number, _signal: AbortSignal): Promise<void> {
  // stub — no abort awareness; abort tests fail because this waits out the full delay
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
