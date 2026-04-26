import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStream } from '@anthropic-ai/sdk/lib/BetaMessageStream.mjs';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';

export abstract class IMessageStreamer {
  public abstract stream(body: BetaMessageStreamParams, options: Anthropic.RequestOptions): BetaMessageStream;
}
