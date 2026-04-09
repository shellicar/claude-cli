import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';
import versionJson from '@shellicar/build-version/version';
import type { ILogger } from '../public/types';
import { customFetch } from './http/customFetch';
import { TokenRefreshingAnthropic } from './http/TokenRefreshingAnthropic';
import { IMessageStreamer } from './MessageStreamer';

export type AnthropicClientOptions = {
  authToken: () => Promise<string>;
  logger?: ILogger;
};

/**
 * Anthropic API client: owns auth, token refresh, HTTP transport, and streaming.
 *
 * Extracted from `AnthropicAgent` so the agent can compose an API client with a
 * conversation (first step of the refactor series in issue #232). Extends
 * `IMessageStreamer` directly because streaming is this client's primary
 * (currently only) job; the previous paper-thin `AnthropicMessageStreamer`
 * wrapper has been removed as part of the same change.
 */
export class AnthropicClient extends IMessageStreamer {
  readonly #raw: TokenRefreshingAnthropic;

  public constructor(options: AnthropicClientOptions) {
    super();
    const defaultHeaders = {
      'user-agent': `@shellicar/claude-sdk/${versionJson.version}`,
    };
    this.#raw = new TokenRefreshingAnthropic({
      authToken: options.authToken,
      fetch: customFetch(options.logger),
      logger: options.logger,
      defaultHeaders,
    });
  }

  public stream(body: BetaMessageStreamParams, options: Anthropic.RequestOptions): AsyncIterable<BetaRawMessageStreamEvent> {
    return this.#raw.beta.messages.stream(body, options);
  }
}
