import EventEmitter from 'node:events';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { BetaMessageStream } from '@anthropic-ai/sdk/lib/BetaMessageStream.mjs';
import versionJson from '@shellicar/build-version/version';
import type { ILogger } from '../public/types';
import { customFetch } from './http/customFetch';
import { TokenRefreshingAnthropic } from './http/TokenRefreshingAnthropic';
import { IMessageStreamer } from './MessageStreamer';

export type AnthropicClientOptions = {
  authToken: () => Promise<string>;
  logger?: ILogger;
};

type AnthropicClientEvents = {
  finalMessage: [msg: BetaMessage];
};

/**
 * Anthropic API client: HTTP transport to the Anthropic streaming endpoint,
 * wrapped with automatic bearer-token refresh.
 *
 * What this class owns:
 * - Token refresh timing via `TokenRefreshingAnthropic`. When a request goes
 *   out and the cached token is stale, `TokenRefreshingAnthropic` swaps it
 *   out before the request leaves.
 * - The HTTP transport (`customFetch`, with logging wired in).
 * - Client-identifying headers: `user-agent` carries the SDK package name
 *   and version, identifying "who is calling" the Anthropic API. These are
 *   static for the life of the instance.
 *
 * What this class does NOT own:
 * - The OAuth flow (token acquisition, login, credential storage). That
 *   lives in `private/Auth/` and feeds this class via the `authToken`
 *   callback passed to the constructor. This class only holds the refresh
 *   loop, not the initial token acquisition.
 * - Feature beta headers (`anthropic-beta`). Those describe "what features
 *   this specific request is using" and are computed per request by the
 *   request builder from the durable config, then passed in via the
 *   `options.headers` argument to `stream`.
 * - The request body. The request builder produces the body; this class
 *   forwards it without inspection.
 * - The abort signal. The turn runner merges the per-query signal into the
 *   `options` argument before calling `stream`.
 *
 * See `.claude/plans/sdk-shape.md` (Client block) for the design.
 */
export class AnthropicClient extends IMessageStreamer {
  readonly #raw: TokenRefreshingAnthropic;
  readonly #emitter = new EventEmitter<AnthropicClientEvents>();

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

  public on<K extends keyof AnthropicClientEvents>(event: K, listener: (...args: AnthropicClientEvents[K]) => void): void {
    this.#emitter.on(event, listener);
  }

  public off<K extends keyof AnthropicClientEvents>(event: K, listener: (...args: AnthropicClientEvents[K]) => void): void {
    this.#emitter.off(event, listener);
  }

  public stream(body: BetaMessageStreamParams, options: Anthropic.RequestOptions): BetaMessageStream {
    const stream = this.#raw.beta.messages.stream(body, options);
    stream.on('finalMessage', (msg) => {
      try {
        this.#emitter.emit('finalMessage', msg);
      } catch {
        // Listener errors must not propagate into stream processing
      }
    });
    return stream;
  }
}
