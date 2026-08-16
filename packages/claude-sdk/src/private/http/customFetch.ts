import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { getBody } from './getBody';
import { getHeaders } from './getHeaders';

export const customFetch = (logger: ILogger | undefined) => {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const headers = getHeaders(init?.headers);
    const body = getBody(init?.body, headers);

    logger?.info('HTTP Request', {
      headers,
      method: init?.method,
      body,
    });
    const startMs = Date.now();
    let response: Response;
    // try {
    response = await fetch(input, init);
    // } catch (error) {
    //   logger?.error('HTTP Request failed', { method: init?.method, elapsedMs: Date.now() - startMs, error });
    //   throw error;
    // }
    const elapsedMs = Date.now() - startMs;
    const isStream = response.headers.get('content-type')?.includes('text/event-stream') ?? false;
    if (!isStream) {
      const text = await response.clone().text();
      let responseBody: unknown = text;
      try {
        responseBody = JSON.parse(text);
      } catch {
        // keep as text
      }
      logger?.info('HTTP Response', {
        headers: getHeaders(response.headers),
        status: response.status,
        statusText: response.statusText,
        elapsedMs,
        body: responseBody,
      });
    } else {
      logger?.info('HTTP Response', {
        headers: getHeaders(response.headers),
        status: response.status,
        statusText: response.statusText,
        elapsedMs,
      });
    }
    return response;
  };
};
