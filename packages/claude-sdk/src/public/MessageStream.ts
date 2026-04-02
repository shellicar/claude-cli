import EventEmitter from 'node:events';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { ILogger } from './types';

type ToolUseAccumulator = {
  id: string;
  name: string;
  partialJson: string;
};

export type ToolUseResult = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type MessageStreamResult = {
  text: string;
  toolUses: ToolUseResult[];
  stopReason: string | null;
};

type MessageStreamEvents = {
  message_start: [];
  message_text: [text: string];
  message_stop: [];
};

export class MessageStream extends EventEmitter<MessageStreamEvents> {
  readonly #logger: ILogger | undefined;
  #text = '';
  #accumulating = new Map<number, ToolUseAccumulator>();
  #stopReason: string | null = null;

  public constructor(logger?: ILogger) {
    super();
    this.#logger = logger;
  }

  async process(
    stream: AsyncIterable<Anthropic.Beta.Messages.BetaRawMessageStreamEvent>,
  ): Promise<MessageStreamResult> {
    for await (const event of stream) {
      this.#handleEvent(event);
    }
    return {
      text: this.#text,
      toolUses: [...this.#accumulating.values()].map(acc => ({
        id: acc.id,
        name: acc.name,
        input: acc.partialJson.length > 0 ? JSON.parse(acc.partialJson) : {},
      })),
      stopReason: this.#stopReason,
    };
  }

  #handleEvent(event: Anthropic.Beta.Messages.BetaRawMessageStreamEvent): void {
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
        if (event.content_block.type === 'tool_use') {
          this.#logger?.debug('tool_use_start', { name: event.content_block.name, id: event.content_block.id });
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
