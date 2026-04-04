import EventEmitter from 'node:events';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { ILogger } from '../public/types';
import type { ContentBlock, MessageStreamEvents, MessageStreamResult } from './types';

type BlockAccumulator =
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; partialJson: string };

export class MessageStream extends EventEmitter<MessageStreamEvents> {
  readonly #logger: ILogger | undefined;
  #current: BlockAccumulator | null = null;
  #completed: ContentBlock[] = [];
  #stopReason: string | null = null;

  public constructor(logger?: ILogger) {
    super();
    this.#logger = logger;
  }

  public async process(stream: AsyncIterable<Anthropic.Beta.Messages.BetaRawMessageStreamEvent>): Promise<MessageStreamResult> {
    for await (const event of stream) {
      this.#handleEvent(event);
    }
    return { blocks: this.#completed, stopReason: this.#stopReason };
  }

  #handleEvent(event: Anthropic.Beta.Messages.BetaRawMessageStreamEvent): void {
    this.#logger?.trace('event', event);
    switch (event.type) {
      case 'message_start':
        this.#logger?.debug('message_start');
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
        break;
      case 'content_block_start':
        this.#logger?.debug('content_block_start', { index: event.index, type: event.content_block.type });
        if (this.#current != null) {
          this.#logger?.warn('content_block_start with existing current block', { existing: this.#current.type, incoming: event.content_block.type });
        }
        if (event.content_block.type === 'tool_use') {
          this.#logger?.info('tool_use_start', { name: event.content_block.name });
          this.#current = { type: 'tool_use', id: event.content_block.id, name: event.content_block.name, partialJson: '' };
        } else if (event.content_block.type === 'thinking') {
          this.#current = { type: 'thinking', thinking: '', signature: '' };
          this.emit('thinking_start');
        } else if (event.content_block.type === 'text') {
          this.#current = { type: 'text', text: '' };
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
        if (acc.type === 'thinking') {
          this.#completed.push({ type: 'thinking', thinking: acc.thinking, signature: acc.signature });
          this.emit('thinking_stop');
        } else if (acc.type === 'text') {
          this.#completed.push({ type: 'text', text: acc.text });
        } else if (acc.type === 'tool_use') {
          this.#completed.push({ type: 'tool_use', id: acc.id, name: acc.name, input: acc.partialJson.length > 0 ? JSON.parse(acc.partialJson) : {} });
        }
        break;
      }
      case 'content_block_delta':
        if (event.delta.type === 'text_delta' && this.#current?.type === 'text') {
          this.#current.text += event.delta.text;
          this.emit('message_text', event.delta.text);
        } else if (event.delta.type === 'input_json_delta' && this.#current?.type === 'tool_use') {
          this.#current.partialJson += event.delta.partial_json;
        } else if (event.delta.type === 'thinking_delta' && this.#current?.type === 'thinking') {
          this.#current.thinking += event.delta.thinking;
          this.emit('thinking_text', event.delta.thinking);
        } else if (event.delta.type === 'signature_delta' && this.#current?.type === 'thinking') {
          this.#current.signature += event.delta.signature;
        }
        break;
    }
  }
}
