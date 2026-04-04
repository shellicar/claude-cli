export type ApprovalResponse = {
  approved: boolean;
  reason?: string;
};

export type ToolUseResult = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ContentBlock = { type: 'thinking'; thinking: string; signature: string } | { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export type MessageStreamResult = {
  blocks: ContentBlock[];
  stopReason: string | null;
};

export type MessageStreamEvents = {
  message_start: [];
  message_text: [text: string];
  message_stop: [];
  thinking_start: [];
  thinking_text: [text: string];
  thinking_stop: [];
};
