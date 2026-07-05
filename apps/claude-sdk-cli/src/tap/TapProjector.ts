import type { ConsumerMessage, SdkMessage } from '@shellicar/claude-sdk';
import type { TapEventBody } from './TapEvent.js';

/** Maps the SDK/consumer message streams to spec event bodies. Returns null for messages that project to
 * nothing (the majority: text/thinking deltas, block lifecycle, tool_result, …). */
export class TapProjector {
  // tool_use_input_stop carries id + input but not name; the name arrives earlier on tool_use_start.
  // Correlate by id across the two messages (plan §2).
  readonly #toolNames = new Map<string, string>();

  public fromSdk(msg: SdkMessage): TapEventBody | null {
    switch (msg.type) {
      case 'message_start':
        return { type: 'turn_started' };
      case 'done':
        return { type: 'turn_ended', stopReason: msg.stopReason };
      case 'tool_use_start':
        this.#toolNames.set(msg.id, msg.name);
        return null;
      case 'tool_use_input_stop': {
        const name = this.#toolNames.get(msg.id) ?? 'unknown';
        this.#toolNames.delete(msg.id);
        return { type: 'tool_use', id: msg.id, name, input: msg.input };
      }
      case 'tool_approval_request':
        return { type: 'approval_pending', toolUseId: msg.requestId };
      case 'message_usage':
        return {
          type: 'usage',
          inputTokens: msg.inputTokens,
          cacheCreationTokens: msg.cacheCreationTokens,
          cacheReadTokens: msg.cacheReadTokens,
          outputTokens: msg.outputTokens,
          costUsd: msg.costUsd,
        };
      default:
        return null;
    }
  }

  public fromConsumer(msg: ConsumerMessage): TapEventBody | null {
    if (msg.type === 'tool_approval_response') {
      return { type: 'approval_settled', toolUseId: msg.requestId, approved: msg.approved };
    }
    return null;
  }
}
