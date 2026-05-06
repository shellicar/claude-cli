import type { BetaMessageStream } from '@anthropic-ai/sdk/lib/BetaMessageStream.mjs';
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta.mjs';
import { IStreamProcessor } from '../public/interfaces';
import type { ContentBlock, ILogger } from '../public/types';
import type { MessageStreamResult } from './types';

const SERVER_TOOL_RESULT_NAMES = {
  web_search_tool_result: 'web_search',
  web_fetch_tool_result: 'web_fetch',
  code_execution_tool_result: 'code_execution',
  bash_code_execution_tool_result: 'bash_code_execution',
  text_editor_code_execution_tool_result: 'text_editor_code_execution',
  tool_search_tool_result: 'tool_search',
  mcp_tool_result: 'mcp',
} as const;

/**
 * Long-lived stream processor. Constructed once at consumer setup and reused
 * for every stream the SDK runs. The consumer subscribes to `.on(...)` events
 * once at setup and the same handlers fire for every stream this instance
 * processes.
 *
 * Per-stream state lives entirely in the SDK's `BetaMessageStream` instance
 * and is assembled by the SDK. This processor subscribes to the stream's
 * events, re-emits them in the `MessageStreamEvents` vocabulary, and then
 * awaits `finalMessage()` to obtain the fully assembled result.
 *
 * Concurrent `process()` calls on the same instance are not supported: the
 * intended usage is one call at a time. The events emitted during a call
 * belong to that call; interleaving two calls would mix events on the shared
 * emitter and confuse subscribers.
 */
export class StreamProcessor extends IStreamProcessor {
  readonly #logger: ILogger | undefined;

  public constructor(logger?: ILogger) {
    super();
    this.#logger = logger;
  }

  public async process(stream: BetaMessageStream): Promise<MessageStreamResult> {
    stream.on('streamEvent', (event) => {
      this.#logger?.trace('event', event);
      if (event.type === 'message_start') {
        this.#logger?.debug('message_start');
        this.emit('message_start');
      } else if (event.type === 'content_block_start') {
        this.#logger?.debug('content_block_start', { index: event.index, type: event.content_block.type });
        if (event.content_block.type === 'thinking') {
          this.emit('thinking_start');
        } else if (event.content_block.type === 'compaction') {
          this.emit('compaction_start');
        } else if (event.content_block.type === 'server_tool_use') {
          this.#logger?.info('server_tool_use_start', { name: event.content_block.name });
        } else if (event.content_block.type === 'tool_use') {
          this.#logger?.info('tool_use_start', { name: event.content_block.name });
        }
      } else if (event.type === 'message_delta') {
        if (event.delta.stop_reason != null) {
          this.#logger?.debug('stop_reason', { reason: event.delta.stop_reason });
        }
        if (event.context_management != null) {
          this.#logger?.info('context_management', { context_management: event.context_management });
        }
      }
    });

    stream.on('text', (delta) => {
      this.emit('message_text', delta);
    });

    stream.on('thinking', (delta) => {
      this.emit('thinking_text', delta);
    });

    stream.on('contentBlock', (content) => {
      this.#logger?.debug('content_block_stop', { type: content.type });
      switch (content.type) {
        case 'thinking':
          this.emit('thinking_stop');
          break;
        case 'compaction':
          this.emit('compaction_complete', content.content || 'No compaction summary received');
          break;
        case 'server_tool_use':
          this.emit('server_tool_use', content.name, content.input);
          break;
        case 'web_search_tool_result':
        case 'web_fetch_tool_result':
        case 'code_execution_tool_result':
        case 'bash_code_execution_tool_result':
        case 'text_editor_code_execution_tool_result':
        case 'tool_search_tool_result':
        case 'mcp_tool_result':
          this.emit('server_tool_result', SERVER_TOOL_RESULT_NAMES[content.type], content.content as unknown);
          break;
      }
    });

    stream.on('end', () => {
      this.emit('message_stop');
    });

    const msg = await stream.finalMessage();
    return {
      blocks: mapBlocks(msg.content),
      stopReason: msg.stop_reason,
      contextManagementOccurred: msg.context_management != null,
      usage: {
        inputTokens: msg.usage.input_tokens,
        cacheCreationTokens: msg.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
        outputTokens: msg.usage.output_tokens,
      },
    };
  }
}

function mapBlocks(content: ReadonlyArray<BetaContentBlock>): ContentBlock[] {
  const result: ContentBlock[] = [];
  for (const block of content) {
    switch (block.type) {
      case 'text':
        result.push({ type: 'text', text: block.text });
        break;
      case 'thinking':
        result.push({ type: 'thinking', thinking: block.thinking, signature: block.signature });
        break;
      case 'redacted_thinking':
        result.push({ type: 'redacted_thinking', data: block.data });
        break;
      case 'tool_use':
        result.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input as Record<string, unknown> });
        break;
      case 'compaction':
        result.push({ type: 'compaction', content: block.content ?? '' });
        break;
      case 'server_tool_use':
        result.push({ type: 'server_tool_use', id: block.id, name: block.name, input: block.input });
        break;
      case 'web_search_tool_result':
      case 'web_fetch_tool_result':
      case 'code_execution_tool_result':
      case 'bash_code_execution_tool_result':
      case 'text_editor_code_execution_tool_result':
      case 'tool_search_tool_result':
      case 'mcp_tool_result':
        result.push({ type: block.type, toolUseId: block.tool_use_id, content: block.content });
        break;
      case 'mcp_tool_use':
      case 'container_upload':
        // Ignored: matches current behavior (explicit break in content_block_start)
        break;
    }
  }
  return result;
}
