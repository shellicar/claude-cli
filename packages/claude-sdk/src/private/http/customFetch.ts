import type { ILogger } from '../../public/types';
import { getBody } from './getBody';
import { getHeaders } from './getHeaders';

export const customFetch = (logger: ILogger | undefined, getToken?: () => Promise<string>) => {
  return async (input: string | URL | Request, init?: RequestInit) => {
    let resolvedInit = init;
    if (getToken) {
      const token = await getToken();
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      resolvedInit = { ...init, headers };
    }
    const headers = getHeaders(resolvedInit?.headers);
    const body = getBody(resolvedInit?.body, headers);

    logger?.info('HTTP Request', {
      headers,
      method: init?.method,
      body,
    });
    const response = await fetch(input, resolvedInit);
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
