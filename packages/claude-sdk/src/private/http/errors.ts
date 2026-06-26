/** Base for every error the owned transport raises. */
export class TransportError extends Error {}

/** Non-2xx HTTP response at stream connect. Carries status + parsed retry-after. */
export class HttpError extends TransportError {
  public constructor(
    public readonly status: number,
    public readonly retryAfterMs: number | undefined,
    public readonly body: unknown,
    public readonly headers: Headers,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

/** Mid-stream SSE `error` event (arrives after a 200 OK). `type` is body.error.type. */
export class ApiStreamError extends TransportError {
  public constructor(
    public readonly type: string | undefined,
    public readonly body: unknown,
  ) {
    super(`API stream error${type ? `: ${type}` : ''}`);
    this.name = 'ApiStreamError';
  }
}

/** Connection failure before/instead of a response. */
export class ConnectionError extends TransportError {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConnectionError';
  }
}

/** Request exceeded the streaming timeout. A retryable connection failure. */
export class TimeoutError extends ConnectionError {
  public constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** Give-up sentinel: the account-limit budget elapsed and the retry loop stopped.
 * Not a transport failure — a deliberate stop. The 🛑 notice is already raised via
 * the AccountLimitListener; QueryRunner catches this to end the query cleanly with
 * no error surfaced. */
export class AccountLimitStoppedError extends Error {
  public constructor() {
    super('Account limit — stopped');
    this.name = 'AccountLimitStoppedError';
  }
}

/** Parses `retry-after-ms` then `retry-after` (seconds or HTTP-date) into ms.
 * Mirrors @anthropic-ai/sdk client.mjs retryRequest. Returns undefined when
 * neither header is present or parseable. */
export function parseRetryAfter(_headers: Headers): number | undefined {
  throw new Error('not implemented');
}

export function safeJsonParse(_text: string): unknown {
  throw new Error('not implemented');
}

export async function safeReadBody(_response: Response): Promise<unknown> {
  throw new Error('not implemented');
}
