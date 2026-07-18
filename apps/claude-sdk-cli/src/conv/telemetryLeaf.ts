import type { ConvTelemetryBody } from './ConvTelemetryProjector.js';

/** v2 routes telemetry by subject leaf, never a body `type` (conversation-spec). Maps each projected
 *  body's `type` to its leaf and strips the type off, since the subject already spells it. */
export const telemetryLeaf = (body: ConvTelemetryBody): { leaf: string; rest: Omit<ConvTelemetryBody, 'type'> } => {
  const { type, ...rest } = body;
  const leaves: Record<ConvTelemetryBody['type'], string> = {
    turn_started: 'turn.started',
    turn_ended: 'turn.ended',
    turn_cancelled: 'turn.cancelled',
    turn_aborted: 'turn.aborted',
    tool_use: 'tool.use',
    usage: 'usage',
  };
  return { leaf: leaves[type], rest };
};
