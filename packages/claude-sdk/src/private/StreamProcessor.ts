import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta.mjs';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di-lite';
import { IStreamProcessor, IToolRegistry } from '../public/interfaces';
import type { ContentBlock } from '../public/types';
import { MessageAccumulator } from './http/accumulator';
import type { IMessageStream } from './MessageStreamer';
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
  @dependsOn(ILogger) private readonly logger!: ILogger;
  @dependsOn(IToolRegistry) private readonly registry!: IToolRegistry;

  public async process(stream: IMessageStream): Promise<MessageStreamResult> {
    let currentToolId: string | null = null;
    // Set when the first tool_use/server_tool_use block starts. The API guarantees
    // stop_reason === 'tool_use' when tool blocks are present, so tool_batch_end is
    // emitted on that stop_reason rather than guessed.
    let hasToolBatch = false;
    const accumulator = new MessageAccumulator();

    for await (const event of stream) {
      this.logger.trace('event', event);
      switch (event.type) {
        case 'message_start':
          accumulator.start(event);
          this.logger.debug('message_start');
          this.emit('message_start');
          break;
        case 'content_block_start': {
          accumulator.startBlock(event);
          this.logger.debug('content_block_start', { index: event.index, type: event.content_block.type });
          this.emit('enter_block', event.content_block.type);
          if (event.content_block.type === 'thinking') {
            this.emit('thinking_start');
          } else if (event.content_block.type === 'compaction') {
            this.emit('compaction_start');
          } else if (event.content_block.type === 'server_tool_use') {
            if (!hasToolBatch) {
              this.emit('tool_batch_start');
              hasToolBatch = true;
            }
            this.logger.info('server_tool_use_start', { id: event.content_block.id, name: event.content_block.name });
            currentToolId = event.content_block.id;
            this.emit('server_tool_use_start', event.content_block.id, event.content_block.name);
          } else if (event.content_block.type === 'tool_use') {
            if (!hasToolBatch) {
              this.emit('tool_batch_start');
              hasToolBatch = true;
            }
            this.logger.info('tool_use_start', { id: event.content_block.id, name: event.content_block.name });
            currentToolId = event.content_block.id;
            this.emit('tool_use_start', event.content_block.id, event.content_block.name);
          }
          break;
        }
        case 'content_block_delta': {
          accumulator.delta(event);
          const d = event.delta;
          if (d.type === 'text_delta') {
            this.emit('message_text', d.text);
          } else if (d.type === 'thinking_delta') {
            this.emit('thinking_text', d.thinking);
          } else if (d.type === 'input_json_delta') {
            // mcp_tool_use blocks fire input_json too; currentToolId is only set for
            // tool_use and server_tool_use, so their deltas drop here.
            if (currentToolId) {
              this.emit('tool_use_input_delta', currentToolId, d.partial_json);
            }
          }
          break;
        }
        case 'content_block_stop': {
          const content = accumulator.stopBlock(event.index);
          this.logger.debug('content_block_stop', { type: content.type });
          this.emit('exit_block', content.type);
          switch (content.type) {
            case 'text':
              break;
            case 'thinking':
              this.emit('thinking_stop');
              break;
            case 'compaction':
              this.emit('compaction_complete', content.content || 'No compaction summary received');
              break;
            case 'tool_use':
              // Replace the marked paths in the raw input, in place, ONCE — before the
              // display (this emit), the permission check, and the handler read it. All
              // three hold this same object, so none re-derives the path.
              this.registry.normaliseInputPaths(content.name, content.input as Record<string, unknown>);
              // Client tool block complete and parsed: consumer flips from the raw
              // streamed JSON to the resolved tool view here, before approval.
              this.emit('tool_use_input_stop', content.id, content.input as Record<string, unknown>);
              break;
            case 'server_tool_use':
              this.emit('server_tool_use', content.id, content.name, content.input);
              break;
            case 'web_search_tool_result':
            case 'web_fetch_tool_result':
            case 'code_execution_tool_result':
            case 'bash_code_execution_tool_result':
            case 'text_editor_code_execution_tool_result':
            case 'tool_search_tool_result':
            case 'mcp_tool_result':
              this.emit('server_tool_result', (content as { tool_use_id: string }).tool_use_id, SERVER_TOOL_RESULT_NAMES[content.type], content.content as unknown);
              break;
          }
          currentToolId = null;
          break;
        }
        case 'message_delta':
          accumulator.messageDelta(event);
          if (event.delta.stop_reason != null) {
            this.logger.debug('stop_reason', { reason: event.delta.stop_reason });
          }
          if (event.delta.stop_reason === 'tool_use') {
            this.emit('tool_batch_end');
          }
          if (event.context_management != null) {
            this.logger.info('context_management', { context_management: event.context_management });
          }
          break;
        case 'message_stop':
          // The message's stop_reason arrives on the preceding message_delta, so it is set
          // on the accumulator by the time this fires. Carry it on the event so a per-round
          // consumer (the tap's turn_ended) has the round's reason without waiting for `done`.
          this.emit('message_stop', accumulator.message.stop_reason ?? 'end_turn');
          break;
      }
    }

    const msg = accumulator.message;
    this.emit('final_message', msg);
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
    // A stream that opens a block above index 0 leaves earlier indices as holes,
    // which `for...of` visits as undefined; skip them rather than read `.type`.
    if (block == null) {
      continue;
    }
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
