import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';

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
export async function* streamMessages(_params: TransportParams): AsyncGenerator<BetaRawMessageStreamEvent> {
  throw new Error('not implemented');
}
