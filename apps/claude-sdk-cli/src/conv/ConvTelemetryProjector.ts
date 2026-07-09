import { IDurableConfigProvider, type SdkMessage } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import { ConversationSession } from '../model/ConversationSession.js';

/** The conv telemetry bodies (minus the envelope `ts`, which `stamp` adds). One per spec telemetry event. */
export type ConvTelemetryBody =
  | { type: 'turn_started'; queryId: string; turnId: string; service: string; model: string; thinking: boolean; effort?: string; maxTokens: number }
  | { type: 'turn_ended'; queryId: string; turnId: string; stopReason: string }
  | { type: 'turn_cancelled'; queryId: string; turnId: string }
  | { type: 'turn_aborted'; queryId: string; turnId: string }
  | { type: 'tool_use'; queryId: string; turnId: string; id: string; name: string; input: Record<string, unknown> }
  | { type: 'usage'; queryId: string; turnId: string; service: string; model: string; inputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; outputTokens: number; costUsd?: number };

const SERVICE = 'anthropic.messages';

/** The projector's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConvTelemetryProjector {
  public abstract fromSdk(msg: SdkMessage): ConvTelemetryBody | null;
  public abstract cancelled(): ConvTelemetryBody;
}

/**
 * `TapProjector` re-cut to the conv telemetry events. Reads the round's ids off the conversation tip (the
 * locked "served off the in-memory array") and the request inputs from the durable config, because the
 * SDK's bare `message_start` carries neither. `tool_use_start` only records the name; the `tool_use`
 * event fires on `tool_use_input_stop` once the input is complete.
 */
export class ConvTelemetryProjector extends IConvTelemetryProjector {
  @dependsOn(ConversationSession) private readonly session!: ConversationSession;
  @dependsOn(IDurableConfigProvider) private readonly durable!: IDurableConfigProvider;
  readonly #toolNames = new Map<string, string>();

  public fromSdk(msg: SdkMessage): ConvTelemetryBody | null {
    const tip = this.session.conversationTip();
    const queryId = tip?.queryId ?? '';
    const turnId = tip?.turnId ?? '';
    switch (msg.type) {
      case 'message_start': {
        // WRONG, NOT TECH-DEBT (deliberate v1 limitation, SC-ruled): model/thinking/effort/maxTokens are
        // read from live durable config here, not from the request the turn actually sent. If a config
        // reload lands mid-turn, turn_started can report inputs the turn did not use. Threading the real
        // request inputs onto message_start is a wider SDK change deferred past v1.
        const c = this.durable.config;
        return { type: 'turn_started', queryId, turnId, service: SERVICE, model: c.model, thinking: c.thinking ?? false, effort: c.thinkingEffort, maxTokens: c.maxTokens };
      }
      case 'message_end':
        this.#toolNames.clear();
        return { type: 'turn_ended', queryId, turnId, stopReason: msg.stopReason };
      case 'tool_use_start':
        this.#toolNames.set(msg.id, msg.name);
        return null;
      case 'tool_use_input_stop': {
        const name = this.#toolNames.get(msg.id) ?? 'unknown';
        this.#toolNames.delete(msg.id);
        return { type: 'tool_use', queryId, turnId, id: msg.id, name, input: msg.input };
      }
      case 'message_usage':
        // One usage per turn (the SDK reports once). Per-frame extras (cacheCreation5m/1h, thinkingTokens,
        // serverToolUse) are omitted — report what you know, never synthesise.
        return { type: 'usage', queryId, turnId, service: SERVICE, model: this.durable.config.model, inputTokens: msg.inputTokens, cacheCreationTokens: msg.cacheCreationTokens, cacheReadTokens: msg.cacheReadTokens, outputTokens: msg.outputTokens, costUsd: msg.costUsd };
      case 'error':
        return { type: 'turn_aborted', queryId, turnId }; // the attempt failed — distinct from a cancel
      default:
        return null;
    }
  }

  /** A cancel accepted mid-turn — someone decided. Driven from the consumerChannel outcome. */
  public cancelled(): ConvTelemetryBody {
    const tip = this.session.conversationTip();
    return { type: 'turn_cancelled', queryId: tip?.queryId ?? '', turnId: tip?.turnId ?? '' };
  }
}
