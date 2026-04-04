import EventEmitter from 'node:events';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { ILogger } from '../public/types';
import type { MessageStreamEvents, MessageStreamResult, ToolUseAccumulator } from './types';

export class MessageStream extends EventEmitter<MessageStreamEvents> {
  readonly #logger: ILogger | undefined;
  #text = '';
  #accumulating = new Map<number, ToolUseAccumulator>();
  #stopReason: string | null = null;

  public constructor(logger?: ILogger) {
    super();
    this.#logger = logger;
  }

  public async process(stream: AsyncIterable<Anthropic.Beta.Messages.BetaRawMessageStreamEvent>): Promise<MessageStreamResult> {
    for await (const event of stream) {
      this.#handleEvent(event);
    }
    return {
      text: this.#text,
      toolUses: [...this.#accumulating.values()].map((acc) => ({
        id: acc.id,
        name: acc.name,
        input: acc.partialJson.length > 0 ? JSON.parse(acc.partialJson) : {},
      })),
      stopReason: this.#stopReason,
    };
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
        if (event.content_block.type === 'tool_use') {
          this.#logger?.info('tool_use_start', { name: event.content_block.name });
          this.#accumulating.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
            partialJson: '',
          });
        }
        break;
      case 'content_block_delta':
        if (event.delta.type === 'text_delta') {
          this.#text += event.delta.text;
          this.emit('message_text', event.delta.text);
        } else if (event.delta.type === 'input_json_delta') {
          const acc = this.#accumulating.get(event.index);
          if (acc != null) {
            acc.partialJson += event.delta.partial_json;
          }
        }
        break;
    }
  }
}
