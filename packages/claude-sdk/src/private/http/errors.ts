import type { SdkErrorDetail } from '../../public/types';

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

/** A mid-stream socket death after a 200 OK (undici `terminated`), e.g. the
 * machine slept mid-turn. Its own class so the retry loop can give it a short,
 * fixed-delay strategy distinct from the exponential transient backoff. */
export class StreamInterruptedError extends TransportError {
  public constructor(options?: { cause?: unknown }) {
    super('Stream interrupted', options);
    this.name = 'StreamInterruptedError';
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
export function parseRetryAfter(headers: Headers): number | undefined {
  const ms = headers.get('retry-after-ms');
  if (ms != null) {
    const parsed = Number.parseFloat(ms);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  const after = headers.get('retry-after');
  if (after != null) {
    const seconds = Number.parseFloat(after);
    if (!Number.isNaN(seconds)) {
      return seconds * 1000;
    }
    const date = Date.parse(after);
    if (!Number.isNaN(date)) {
      return date - Date.now();
    }
  }
  return undefined;
}

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Reads the `{ error: { type, message } }` shape an Anthropic error response carries in its
 * parsed body. The body is `unknown` off the wire, so every field is guarded; a body that
 * does not match the shape yields undefined. */
function readBodyError(body: unknown): { type?: string; message?: string } | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return undefined;
  }
  const inner = (body as { error: unknown }).error;
  if (typeof inner !== 'object' || inner === null) {
    return undefined;
  }
  const type = 'type' in inner && typeof inner.type === 'string' ? inner.type : undefined;
  const message = 'message' in inner && typeof inner.message === 'string' ? inner.message : undefined;
  return { type, message };
}

/** Extracts the structured detail the CLI needs to render a transport failure — status, the
 * API error type, and the human-readable message from the response body. Returns undefined
 * for anything that is not a transport error carrying that detail, so a plain give-up error
 * surfaces as its message alone. */
export function toSdkErrorDetail(err: unknown): SdkErrorDetail | undefined {
  if (err instanceof HttpError) {
    const bodyError = readBodyError(err.body);
    return { status: err.status, type: bodyError?.type, message: bodyError?.message ?? `HTTP ${err.status}` };
  }
  if (err instanceof ApiStreamError) {
    const bodyError = readBodyError(err.body);
    return { type: err.type ?? bodyError?.type, message: bodyError?.message ?? err.message };
  }
  return undefined;
}

export async function safeReadBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return safeJsonParse(text) ?? text;
  } catch {
    return undefined;
  }
}
