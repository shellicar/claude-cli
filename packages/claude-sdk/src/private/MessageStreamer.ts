import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';

export abstract class IMessageStreamer {
  public abstract stream(body: BetaMessageStreamParams, options: Anthropic.RequestOptions): AsyncIterable<BetaRawMessageStreamEvent>;
}
