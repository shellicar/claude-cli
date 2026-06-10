import type { ContentBlock } from '../public/types';

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
  message_stop: [];
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
};
