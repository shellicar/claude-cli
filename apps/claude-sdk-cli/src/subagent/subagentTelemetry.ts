import type { DurableConfig, SdkMessage } from '@shellicar/claude-sdk';
import type { ConvTelemetryBody } from '../conv/ConvTelemetryProjector.js';

/**
 * `ConvTelemetryProjector`'s own projection, re-cut as a pure function instead of a DI class: that
 * class's queryId/turnId come from `IConversationSession` (the one real session, a Singleton), which
 * a subagent cannot substitute per-call without making the class itself Scoped — which would make it
 * a captive dependency of `SdkEventBridge` (a Singleton). A subagent passes its own conversation tip
 * and config straight in instead of going through DI for this at all.
 */
export function projectSubagentTelemetry(msg: SdkMessage, tip: { queryId: string; turnId: string } | undefined, config: DurableConfig, toolNames: Map<string, string>): ConvTelemetryBody | null {
  const queryId = tip?.queryId ?? '';
  const turnId = tip?.turnId ?? '';
  const SERVICE = 'anthropic.messages';
  switch (msg.type) {
    case 'message_start':
      return { type: 'turn_started', queryId, turnId, service: SERVICE, model: config.model, thinking: config.thinking ?? false, effort: config.thinkingEffort, maxTokens: config.maxTokens };
    case 'message_end':
      toolNames.clear();
      return { type: 'turn_ended', queryId, turnId, stopReason: msg.stopReason };
    case 'tool_use_start':
      toolNames.set(msg.id, msg.name);
      return null;
    case 'tool_use_input_stop': {
      const name = toolNames.get(msg.id) ?? 'unknown';
      toolNames.delete(msg.id);
      return { type: 'tool_use', queryId, turnId, id: msg.id, name, input: msg.input };
    }
    case 'message_usage':
      return { type: 'usage', queryId, turnId, service: SERVICE, model: config.model, inputTokens: msg.inputTokens, cacheCreationTokens: msg.cacheCreationTokens, cacheReadTokens: msg.cacheReadTokens, outputTokens: msg.outputTokens, costUsd: msg.costUsd };
    case 'error':
      return { type: 'turn_aborted', queryId, turnId };
    default:
      return null;
  }
}
