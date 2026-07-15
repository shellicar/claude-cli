import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { ContentBlock, SdkMessageUsage } from '../public/types';
import type { MessageIdentity } from './Conversation';

export type ApprovalResponse = {
  approved: boolean;
  reason?: string;
};

export type ToolUseResult = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type MessageUsage = {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
};

export type MessageStreamResult = {
  blocks: ContentBlock[];
  stopReason: string | null;
  contextManagementOccurred: boolean;
  usage: MessageUsage;
};

export type MessageStreamEvents = {
  message_start: [];
  message_text: [text: string];
  message_stop: [stopReason: string];
  thinking_start: [];
  thinking_text: [text: string];
  thinking_stop: [];
  compaction_start: [];
  compaction_complete: [summary: string];
  tool_use_start: [id: string, name: string];
  server_tool_use_start: [id: string, name: string];
  tool_use_input_delta: [id: string, partialJson: string];
  tool_use_input_stop: [id: string, input: Record<string, unknown>];

  server_tool_use: [id: string, name: string, input: Record<string, unknown>];
  server_tool_result: [id: string, name: string, result: unknown];
  enter_block: [type: string];
  exit_block: [type: string];
  tool_batch_start: [];
  tool_batch_end: [];
  // One priced usage frame. The API reports usage cumulatively across a turn (input + cache on
  // message_start, output at message_end); this fires once per frame carrying that frame's own share,
  // delta-tracked so the shares sum to the turn total. Consumers keep accumulating unchanged.
  message_usage: [usage: Omit<SdkMessageUsage, 'type'>];
  // The assembled raw message at stream end, plus the request delta (the trailing
  // user-role message that triggered this API call) and its identity (the round's
  // messageId/turnId/queryId). Consumed by the CLI writer, which lands the two as an
  // alternating user/assistant pair in the audit and projects both into the history
  // index, stamped with the ids. Identity is absent on a legacy round with no id model.
  final_message: [msg: BetaMessage, request?: BetaMessageParam, identity?: MessageIdentity];
};
