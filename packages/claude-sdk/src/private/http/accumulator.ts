import type { BetaContentBlock, BetaMessage, BetaRawContentBlockDeltaEvent, BetaRawContentBlockStartEvent, BetaRawMessageDeltaEvent, BetaRawMessageStartEvent } from '@anthropic-ai/sdk/resources/beta.mjs';

/** Mirrors the subset of @anthropic-ai/sdk's BetaMessageStream accumulation that
 * StreamProcessor reads: per-block text/thinking/signature mutation, a raw JSON
 * buffer for tool input parsed once at block stop, and message-level stop_reason /
 * usage / context_management. */
export class MessageAccumulator {
  public start(_event: BetaRawMessageStartEvent): void {
    throw new Error('not implemented');
  }

  public startBlock(_event: BetaRawContentBlockStartEvent): void {
    throw new Error('not implemented');
  }

  public delta(_event: BetaRawContentBlockDeltaEvent): void {
    throw new Error('not implemented');
  }

  /** Finalise a block at content_block_stop: parse the accumulated tool-input JSON
   * and return the assembled block for the consumer emits. */
  public stopBlock(_index: number): BetaContentBlock {
    throw new Error('not implemented');
  }

  public messageDelta(_event: BetaRawMessageDeltaEvent): void {
    throw new Error('not implemented');
  }

  public get message(): BetaMessage {
    throw new Error('not implemented');
  }
}
