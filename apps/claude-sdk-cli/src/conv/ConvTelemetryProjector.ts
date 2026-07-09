import type { IDurableConfigProvider, SdkMessage } from '@shellicar/claude-sdk';
import type { ConversationSession } from '../model/ConversationSession.js';

/** The conv telemetry bodies (minus the envelope `ts`, which `stamp` adds). One per spec telemetry event. */
export type ConvTelemetryBody =
  | { type: 'turn_started'; queryId: string; turnId: string; service: string; model: string; thinking: boolean; effort?: string; maxTokens: number }
  | { type: 'turn_ended'; queryId: string; turnId: string; stopReason: string }
  | { type: 'turn_cancelled'; queryId: string; turnId: string }
  | { type: 'turn_aborted'; queryId: string; turnId: string }
  | { type: 'tool_use'; queryId: string; turnId: string; id: string; name: string; input: Record<string, unknown> }
  | { type: 'usage'; queryId: string; turnId: string; service: string; model: string; inputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; outputTokens: number; costUsd?: number };

/**
 * Stub. `TapProjector` re-cut to the conv telemetry events (plan §3.2): reads the round's ids off the tip
 * and the request inputs from the durable config (the SDK's bare `message_start` carries neither). The
 * Builder fills the mapping.
 */
export class ConvTelemetryProjector {
  constructor(
    private readonly session: ConversationSession,
    private readonly durable: IDurableConfigProvider,
  ) {}

  public fromSdk(msg: SdkMessage): ConvTelemetryBody | null {
    throw new Error('not implemented');
  }

  /** A cancel accepted mid-turn — someone decided. Driven from the consumerChannel outcome. */
  public cancelled(): ConvTelemetryBody {
    throw new Error('not implemented');
  }
}
