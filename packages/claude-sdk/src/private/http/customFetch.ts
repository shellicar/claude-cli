import type { ILogger } from '../../public/types';
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
    const response = await fetch(input, init);
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
        body: responseBody,
      });
    } else {
      logger?.info('HTTP Response', {
        headers: getHeaders(response.headers),
        status: response.status,
        statusText: response.statusText,
      });
    }
    return response;
  };
};
