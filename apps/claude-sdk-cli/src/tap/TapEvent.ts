/** Creator-supplied metadata. Free-form per the spec ("never parsed for identity"); `location` is an
 * optional member, not a separate field. */
export type TapLabel = Record<string, unknown>;

type TapBase = { run: string; ts: string };

export type TapRunStarted = TapBase & { type: 'run_started'; conv: string; pid: number; label: TapLabel };
export type TapRunEnded = TapBase & { type: 'run_ended'; reason: string };
export type TapHeartbeat = TapBase & { type: 'heartbeat' };
export type TapTurnStarted = TapBase & { type: 'turn_started' };
export type TapTurnEnded = TapBase & { type: 'turn_ended'; stopReason: string };
export type TapToolUse = TapBase & { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
export type TapApprovalPending = TapBase & { type: 'approval_pending'; toolUseId: string };
export type TapApprovalSettled = TapBase & { type: 'approval_settled'; toolUseId: string; approved: boolean };
export type TapUsage = TapBase & {
  type: 'usage';
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type TapEvent = TapRunStarted | TapRunEnded | TapHeartbeat | TapTurnStarted | TapTurnEnded | TapToolUse | TapApprovalPending | TapApprovalSettled | TapUsage;

/** What the projector returns: the event minus the fields the tap stamps (`run`, `ts`) and minus the
 * lifecycle-only events the tap emits itself (`run_started`, `run_ended`, `heartbeat`). */
export type TapEventBody =
  | { type: 'turn_started' }
  | { type: 'turn_ended'; stopReason: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'approval_pending'; toolUseId: string }
  | { type: 'approval_settled'; toolUseId: string; approved: boolean }
  | { type: 'usage'; inputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; outputTokens: number; costUsd: number };
