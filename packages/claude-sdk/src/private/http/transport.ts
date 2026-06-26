import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';
import { ConnectionError, HttpError, parseRetryAfter, safeReadBody, TimeoutError } from './errors';
import { parseSse } from './sse';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages?beta=true';
const ANTHROPIC_VERSION = '2023-06-01';
const STREAM_TIMEOUT_MS = 600_000;

export type TransportParams = {
  body: unknown;
  requestHeaders: Record<string, string> | undefined;
  signal: AbortSignal | undefined;
  authToken: () => Promise<string>;
  fetch: typeof fetch;
  defaultHeaders: Record<string, string>;
};

/**
 * Issues the streaming Messages request and yields raw stream events. Connect-phase
 * failures throw before the first yield (HttpError for non-2xx with status+retry-after,
 * TimeoutError on the timeout cap, ConnectionError otherwise, the abort reason on user
 * abort). Mid-stream SSE `error` events throw during iteration (ApiStreamError). The
 * bearer token is applied per call from the authToken getter (per-request freshness).
 */
export async function* streamMessages(params: TransportParams): AsyncGenerator<BetaRawMessageStreamEvent> {
  const token = await params.authToken();
  const timeout = AbortSignal.timeout(STREAM_TIMEOUT_MS);
  const signal = params.signal ? AbortSignal.any([params.signal, timeout]) : timeout;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    'anthropic-version': ANTHROPIC_VERSION,
    authorization: `Bearer ${token}`,
    ...params.defaultHeaders,
    ...params.requestHeaders,
  };

  let response: Response;
  try {
    response = await params.fetch(ANTHROPIC_URL, { method: 'POST', headers, body: JSON.stringify(params.body), signal });
  } catch (err) {
    if (params.signal?.aborted) {
      throw params.signal.reason;
    }
    if (timeout.aborted) {
      throw new TimeoutError('Request timed out');
    }
    throw new ConnectionError('Connection error', { cause: err });
  }

  if (!response.ok) {
    const retryAfterMs = parseRetryAfter(response.headers);
    const body = await safeReadBody(response);
    throw new HttpError(response.status, retryAfterMs, body, response.headers);
  }
  if (response.body == null) {
    throw new ConnectionError('Response had no body');
  }

  yield* parseSse(response.body, signal);
}
