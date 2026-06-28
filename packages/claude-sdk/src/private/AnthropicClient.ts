import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import versionJson from '@shellicar/build-version/version';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { AnthropicAuth } from './Client/Auth/AnthropicAuth';
import { customFetch } from './http/customFetch';
import { streamMessages } from './http/transport';
import { type IMessageStream, IMessageStreamer } from './MessageStreamer';

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
  readonly #auth: AnthropicAuth;
  readonly #fetch: typeof fetch;
  readonly #defaultHeaders: Record<string, string> = {
    'user-agent': `@shellicar/claude-sdk/${versionJson.version}`,
  };

  // The fetch wrapper is built once, eagerly, so a setup failure surfaces at
  // composition (buildProvider) rather than on the first request. The app's
  // composition root supplies the auth and logger through the factory.
  public constructor(auth: AnthropicAuth, logger: ILogger) {
    super();
    this.#auth = auth;
    this.#fetch = customFetch(logger) as typeof fetch;
  }

  #authToken = async (): Promise<string> => (await this.#auth.getCredentials()).claudeAiOauth.accessToken;

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
