import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta.mjs';

/** The raw event stream the transport yields and StreamProcessor consumes.
 * Connect-phase and mid-stream errors surface as a thrown error during iteration. */
export type IMessageStream = AsyncIterable<BetaRawMessageStreamEvent>;

export abstract class IMessageStreamer {
  public abstract stream(body: BetaMessageStreamParams, options: Anthropic.RequestOptions): IMessageStream;
}
