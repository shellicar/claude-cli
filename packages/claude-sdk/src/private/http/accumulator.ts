import type { BetaContentBlock, BetaMessage, BetaRawContentBlockDeltaEvent, BetaRawContentBlockStartEvent, BetaRawMessageDeltaEvent, BetaRawMessageStartEvent } from '@anthropic-ai/sdk/resources/beta.mjs';

/** Mirrors the subset of @anthropic-ai/sdk's BetaMessageStream accumulation that
 * StreamProcessor reads: per-block text/thinking/signature mutation, a raw JSON
 * buffer for tool input parsed once at block stop, and message-level stop_reason /
 * usage / context_management. */
export class MessageAccumulator {
  #message: BetaMessage | null = null;
  readonly #jsonBuffers = new Map<number, string>();

  public start(event: BetaRawMessageStartEvent): void {
    this.#message = structuredClone(event.message);
  }

  public startBlock(event: BetaRawContentBlockStartEvent): void {
    const message = this.#require();
    message.content[event.index] = structuredClone(event.content_block) as BetaContentBlock;
    if (event.content_block.type === 'tool_use' || event.content_block.type === 'server_tool_use' || event.content_block.type === 'mcp_tool_use') {
      this.#jsonBuffers.set(event.index, '');
    }
  }

  public delta(event: BetaRawContentBlockDeltaEvent): void {
    const block = this.#require().content[event.index];
    if (block == null) {
      return;
    }
    const d = event.delta;
    if (d.type === 'text_delta' && block.type === 'text') {
      block.text += d.text;
    } else if (d.type === 'thinking_delta' && block.type === 'thinking') {
      block.thinking += d.thinking;
    } else if (d.type === 'signature_delta' && block.type === 'thinking') {
      block.signature = d.signature;
    } else if (d.type === 'compaction_delta' && block.type === 'compaction') {
      block.content = (block.content ?? '') + d.content;
    } else if (d.type === 'input_json_delta') {
      this.#jsonBuffers.set(event.index, (this.#jsonBuffers.get(event.index) ?? '') + d.partial_json);
    }
  }

  /** Finalise a block at content_block_stop: parse the accumulated tool-input JSON
   * and return the assembled block for the consumer emits. */
  public stopBlock(index: number): BetaContentBlock {
    const block = this.#require().content[index];
    if (block == null) {
      throw new Error(`content_block_stop for unknown index ${index}`);
    }
    const buffer = this.#jsonBuffers.get(index);
    if (buffer != null && (block.type === 'tool_use' || block.type === 'server_tool_use' || block.type === 'mcp_tool_use')) {
      (block as { input: unknown }).input = buffer.length > 0 ? JSON.parse(buffer) : {};
    }
    return block;
  }

  public messageDelta(event: BetaRawMessageDeltaEvent): void {
    const message = this.#require();
    if (event.delta.stop_reason != null) {
      message.stop_reason = event.delta.stop_reason;
    }
    if (event.delta.stop_sequence != null) {
      message.stop_sequence = event.delta.stop_sequence;
    }
    if (event.delta.container != null) {
      message.container = event.delta.container;
    }
    // context_management is on the message_delta event itself, not its delta.
    if (event.context_management != null) {
      message.context_management = event.context_management;
    }
    // Delta usage carries cumulative counts with nullable fields; keep the prior
    // value where a field is null so the assembled BetaUsage stays non-null.
    const u = event.usage;
    message.usage = {
      ...message.usage,
      ...u,
      input_tokens: u.input_tokens ?? message.usage.input_tokens,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? message.usage.cache_creation_input_tokens,
      cache_read_input_tokens: u.cache_read_input_tokens ?? message.usage.cache_read_input_tokens,
    };
  }

  public get message(): BetaMessage {
    return this.#require();
  }

  #require(): BetaMessage {
    if (this.#message == null) {
      throw new Error('Stream produced events before message_start');
    }
    return this.#message;
  }
}
