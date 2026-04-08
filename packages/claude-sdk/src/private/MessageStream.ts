import EventEmitter from 'node:events';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { CacheCreation, ILogger } from '../public/types';
import type { ContentBlock, MessageStreamEvents, MessageStreamResult } from './types';

type BlockAccumulator = { type: 'thinking'; thinking: string; signature: string } | { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; partialJson: string } | { type: 'compaction'; content: string };

export class MessageStream extends EventEmitter<MessageStreamEvents> {
  readonly #logger: ILogger | undefined;
  #current: BlockAccumulator | null = null;
  #completed: ContentBlock[] = [];
  #stopReason: string | null = null;
  #contextManagementOccurred = false;
  #inputTokens = 0;
  #cacheCreation: CacheCreation | null = null;
  #cacheReadTokens = 0;
  #outputTokens = 0;

  public constructor(logger?: ILogger) {
    super();
    this.#logger = logger;
  }

  public async process(stream: AsyncIterable<Anthropic.Beta.Messages.BetaRawMessageStreamEvent>): Promise<MessageStreamResult> {
    for await (const event of stream) {
      this.#handleEvent(event);
    }
    return {
      blocks: this.#completed,
      stopReason: this.#stopReason,
      contextManagementOccurred: this.#contextManagementOccurred,
      usage: {
        inputTokens: this.#inputTokens,
        cacheCreation: this.#cacheCreation,
        cacheReadTokens: this.#cacheReadTokens,
        outputTokens: this.#outputTokens,
      },
    };
  }

  #handleEvent(event: Anthropic.Beta.Messages.BetaRawMessageStreamEvent): void {
    this.#logger?.trace('event', event);
    switch (event.type) {
      case 'message_start':
        this.#logger?.debug('message_start');
        this.#inputTokens = event.message.usage.input_tokens;
        this.#cacheCreation = event.message.usage.cache_creation ? {
          ephemeral1hTokens: event.message.usage.cache_creation.ephemeral_1h_input_tokens,
          ephemeral5mTokens: event.message.usage.cache_creation.ephemeral_5m_input_tokens
        } : null;
        this.#cacheReadTokens = event.message.usage.cache_read_input_tokens ?? 0;
        this.emit('message_start');
        break;
      case 'message_stop':
        this.#logger?.debug('message_stop');
        this.emit('message_stop');
        break;
      case 'message_delta':
        if (event.delta.stop_reason != null) {
          this.#stopReason = event.delta.stop_reason;
          this.#logger?.debug('stop_reason', { reason: event.delta.stop_reason });
        }
        this.#outputTokens = event.usage.output_tokens;
        if (event.context_management != null) {
          this.#contextManagementOccurred = true;
          this.#logger?.info('context_management', { context_management: event.context_management });
        }
        break;
      case 'content_block_start':
        this.#logger?.debug('content_block_start', { index: event.index, type: event.content_block.type });
        if (this.#current != null) {
          this.#logger?.warn('content_block_start with existing current block', { existing: this.#current.type, incoming: event.content_block.type });
        }
        switch (event.content_block.type) {
          case 'tool_use':
            this.#logger?.info('tool_use_start', { name: event.content_block.name });
            this.#current = { type: 'tool_use', id: event.content_block.id, name: event.content_block.name, partialJson: '' };
            break;
          case 'thinking':
            this.#current = { type: 'thinking', thinking: '', signature: '' };
            this.emit('thinking_start');
            break;
          case 'text':
            this.#current = { type: 'text', text: '' };
            break;
          case 'compaction':
            this.#current = { type: 'compaction', content: '' };
            this.emit('compaction_start');
            break;
        }
        break;
      case 'content_block_stop': {
        this.#logger?.debug('content_block_stop', { type: this.#current?.type });
        const acc = this.#current;
        this.#current = null;
        if (acc == null) {
          this.#logger?.warn('content_block_stop with no current block');
          break;
        }
        switch (acc.type) {
          case 'thinking':
            this.#completed.push({ type: 'thinking', thinking: acc.thinking, signature: acc.signature });
            this.emit('thinking_stop');
            break;
          case 'text':
            this.#completed.push({ type: 'text', text: acc.text });
            break;
          case 'tool_use':
            this.#completed.push({ type: 'tool_use', id: acc.id, name: acc.name, input: acc.partialJson.length > 0 ? JSON.parse(acc.partialJson) : {} });
            break;
          case 'compaction':
            if (acc.content) {
              this.#completed.push({ type: 'compaction', content: acc.content });
            }
            this.emit('compaction_complete', acc.content || 'No compaction summary received');
            break;
        }
        break;
      }
      case 'content_block_delta':
        switch (event.delta.type) {
          case 'text_delta':
            if (this.#current?.type === 'text') {
              this.#current.text += event.delta.text;
              this.emit('message_text', event.delta.text);
            }
            break;
          case 'input_json_delta':
            if (this.#current?.type === 'tool_use') {
              this.#current.partialJson += event.delta.partial_json;
            }
            break;
          case 'thinking_delta':
            if (this.#current?.type === 'thinking') {
              this.#current.thinking += event.delta.thinking;
              this.emit('thinking_text', event.delta.thinking);
            }
            break;
          case 'signature_delta':
            if (this.#current?.type === 'thinking') {
              this.#current.signature += event.delta.signature;
            }
            break;
          case 'compaction_delta':
            if (this.#current?.type === 'compaction') {
              this.#current.content += event.delta.content ?? '';
            }
            break;
          case 'citations_delta':
            break;
        }
        break;
    }
  }
}
