import type { Anthropic } from '@anthropic-ai/sdk';
import { IStreamProcessor } from '../public/interfaces';
import type { ILogger } from '../public/types';
import type { ContentBlock, MessageStreamResult } from './types';

type BlockAccumulator =
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; partialJson: string }
  | { type: 'compaction'; content: string }
  | { type: 'server_tool_use'; id: string; name: string; partialJson: string }
  | { type: 'server_tool_result'; name: string; result: unknown };

/** Derives a tool name from a result block type, e.g. 'web_fetch_tool_result' → 'web_fetch'. */
function toolNameFromResultType(blockType: string): string {
  const suffix = '_tool_result';
  return blockType.endsWith(suffix) ? blockType.slice(0, -suffix.length) : blockType;
}

/**
 * Long-lived stream processor. Constructed once at consumer setup and reused
 * for every stream the SDK runs. The consumer subscribes to `.on(...)` events
 * once at setup and the same handlers fire for every stream this instance
 * processes.
 *
 * Per-stream state (the partial assembled message, cache split tracking, stop
 * reason, token counts) lives in local variables inside the `process()` method,
 * not on the instance. The instance only holds its logger and its event
 * subscriptions.
 *
 * Concurrent `process()` calls on the same instance are not supported: the
 * intended usage is one call at a time. The events emitted during a call
 * belong to that call; interleaving two calls would mix events on the shared
 * emitter and confuse subscribers.
 *
 * Replaces the former per-stream `MessageStream` class, which allocated fresh
 * state on every API call. This processor is long-lived and reuses the same
 * event emitter surface across every stream the turn runner processes.
 */
export class StreamProcessor extends IStreamProcessor {
  readonly #logger: ILogger | undefined;

  public constructor(logger?: ILogger) {
    super();
    this.#logger = logger;
  }

  public async process(stream: AsyncIterable<Anthropic.Beta.Messages.BetaRawMessageStreamEvent>): Promise<MessageStreamResult> {
    let current: BlockAccumulator | null = null;
    const completed: ContentBlock[] = [];
    let stopReason: string | null = null;
    let contextManagementOccurred = false;
    let inputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let outputTokens = 0;

    const handleEvent = (event: Anthropic.Beta.Messages.BetaRawMessageStreamEvent): void => {
      this.#logger?.trace('event', event);
      switch (event.type) {
        case 'message_start':
          this.#logger?.debug('message_start');
          inputTokens = event.message.usage.input_tokens;
          cacheCreationTokens = event.message.usage.cache_creation_input_tokens ?? 0;
          cacheReadTokens = event.message.usage.cache_read_input_tokens ?? 0;
          this.emit('message_start');
          break;
        case 'message_stop':
          this.#logger?.debug('message_stop');
          this.emit('message_stop');
          break;
        case 'message_delta':
          if (event.delta.stop_reason != null) {
            stopReason = event.delta.stop_reason;
            this.#logger?.debug('stop_reason', { reason: event.delta.stop_reason });
          }
          outputTokens = event.usage.output_tokens;
          if (event.context_management != null) {
            contextManagementOccurred = true;
            this.#logger?.info('context_management', { context_management: event.context_management });
          }
          break;
        case 'content_block_start':
          this.#logger?.debug('content_block_start', { index: event.index, type: event.content_block.type });
          if (current != null) {
            this.#logger?.warn('content_block_start with existing current block', { existing: current.type, incoming: event.content_block.type });
          }
          switch (event.content_block.type) {
            case 'tool_use':
              this.#logger?.info('tool_use_start', { name: event.content_block.name });
              current = { type: 'tool_use', id: event.content_block.id, name: event.content_block.name, partialJson: '' };
              break;
            case 'thinking':
              current = { type: 'thinking', thinking: '', signature: '' };
              this.emit('thinking_start');
              break;
            case 'text':
              current = { type: 'text', text: '' };
              break;
            case 'compaction':
              current = { type: 'compaction', content: '' };
              this.emit('compaction_start');
              break;
            case 'server_tool_use': {
              const block = event.content_block as unknown as { id: string; name: string };
              this.#logger?.info('server_tool_use_start', { name: block.name });
              current = { type: 'server_tool_use', id: block.id, name: block.name, partialJson: '' };
              break;
            }
            default: {
              // Result blocks (web_fetch_tool_result, web_search_tool_result, etc.) arrive
              // fully in content_block_start with no deltas — capture the result here.
              const blockType = event.content_block.type;
              const result = (event.content_block as unknown as Record<string, unknown>)['content'];
              current = { type: 'server_tool_result', name: toolNameFromResultType(blockType), result };
              break;
            }
          }
          break;
        case 'content_block_stop': {
          this.#logger?.debug('content_block_stop', { type: current?.type });
          const acc = current;
          current = null;
          if (acc == null) {
            this.#logger?.warn('content_block_stop with no current block');
            break;
          }
          switch (acc.type) {
            case 'thinking':
              completed.push({ type: 'thinking', thinking: acc.thinking, signature: acc.signature });
              this.emit('thinking_stop');
              break;
            case 'text':
              completed.push({ type: 'text', text: acc.text });
              break;
            case 'tool_use':
              completed.push({ type: 'tool_use', id: acc.id, name: acc.name, input: acc.partialJson.length > 0 ? JSON.parse(acc.partialJson) : {} });
              break;
            case 'compaction':
              if (acc.content) {
                completed.push({ type: 'compaction', content: acc.content });
              }
              this.emit('compaction_complete', acc.content || 'No compaction summary received');
              break;
            case 'server_tool_use': {
              const input: Record<string, unknown> = acc.partialJson.length > 0 ? JSON.parse(acc.partialJson) : {};
              this.emit('server_tool_use', acc.name, input);
              break;
            }
            case 'server_tool_result':
              this.emit('server_tool_result', acc.name, acc.result);
              break;
          }
          break;
        }
        case 'content_block_delta':
          switch (event.delta.type) {
            case 'text_delta':
              if (current?.type === 'text') {
                current.text += event.delta.text;
                this.emit('message_text', event.delta.text);
              }
              break;
            case 'input_json_delta':
              if (current?.type === 'tool_use' || current?.type === 'server_tool_use') {
                current.partialJson += event.delta.partial_json;
              }
              break;
            case 'thinking_delta':
              if (current?.type === 'thinking') {
                current.thinking += event.delta.thinking;
                this.emit('thinking_text', event.delta.thinking);
              }
              break;
            case 'signature_delta':
              if (current?.type === 'thinking') {
                current.signature += event.delta.signature;
              }
              break;
            case 'compaction_delta':
              if (current?.type === 'compaction') {
                current.content += event.delta.content ?? '';
              }
              break;
            case 'citations_delta':
              break;
          }
          break;
      }
    };

    for await (const event of stream) {
      handleEvent(event);
    }

    return {
      blocks: completed,
      stopReason,
      contextManagementOccurred,
      usage: {
        inputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        outputTokens,
      },
    };
  }
}
