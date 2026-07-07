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
      case 'message_end':
        // A turn is one round of the agent loop, not the whole exchange: turn_ended fires every round
        // carrying that round's stop reason (`tool_use` mid-loop, `end_turn` on the closing round).
        // The round's stop is where a tool that aborted between tool_use_start and tool_use_input_stop
        // is zeroed — a completed tool already deleted itself, so the map cannot grow across the run.
        this.#toolNames.clear();
        return { type: 'turn_ended', stopReason: msg.stopReason };
      case 'done':
        // Exchange completion is derived by consumers from `stopReason: end_turn`, not emitted as its
        // own event, so `done` projects to nothing.
        return null;
      case 'tool_use_start':
        this.#toolNames.set(msg.id, msg.name);
        return null;
      case 'tool_use_input_stop': {
        const name = this.#toolNames.get(msg.id) ?? 'unknown';
        this.#toolNames.delete(msg.id);
        return { type: 'tool_use', id: msg.id, name, input: msg.input };
      }
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
