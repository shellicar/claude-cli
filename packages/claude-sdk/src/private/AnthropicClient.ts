import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import versionJson from '@shellicar/build-version/version';
import type { ILogger } from '../public/types';
import { customFetch } from './http/customFetch';
import { streamMessages } from './http/transport';
import { type IMessageStream, IMessageStreamer } from './MessageStreamer';

export type AnthropicClientOptions = {
  authToken: () => Promise<string>;
  logger?: ILogger;
};

/**
 * Anthropic API client: owned HTTP/SSE transport to the Anthropic streaming
 * endpoint. The bearer token is applied per request from the `authToken`
 * getter (per-request freshness, the same guarantee the former SDK subclass
 * gave via `bearerAuth`). The `user-agent` header identifies this SDK.
 *
 * Does NOT own the OAuth flow (token acquisition, login, credential storage):
 * that lives in `private/Client/Auth/` and feeds this class via the `authToken`
 * callback. Does NOT own feature beta headers, the request body, or the abort
 * signal — those are produced by the request builder / turn runner and passed
 * through `stream`.
 */
export class AnthropicClient extends IMessageStreamer {
  readonly #authToken: () => Promise<string>;
  readonly #fetch: typeof fetch;
  readonly #defaultHeaders: Record<string, string>;

  public constructor(options: AnthropicClientOptions) {
    super();
    this.#authToken = options.authToken;
    this.#fetch = customFetch(options.logger) as typeof fetch;
    this.#defaultHeaders = {
      'user-agent': `@shellicar/claude-sdk/${versionJson.version}`,
    };
  }

  public stream(body: BetaMessageStreamParams, options: Anthropic.RequestOptions): IMessageStream {
    return streamMessages({
      body,
      requestHeaders: options.headers as Record<string, string> | undefined,
      signal: options.signal ?? undefined,
      authToken: this.#authToken,
      fetch: this.#fetch,
      defaultHeaders: this.#defaultHeaders,
    });
  }
}
