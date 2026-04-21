export type ApprovalResponse = {
  approved: boolean;
  reason?: string;
};

export type ToolUseResult = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ServerToolResultBlock = {
  type: 'web_search_tool_result' | 'web_fetch_tool_result' | 'code_execution_tool_result' | 'bash_code_execution_tool_result' | 'text_editor_code_execution_tool_result' | 'tool_search_tool_result' | 'mcp_tool_result';
  toolUseId: string;
  content: unknown;
};

export type ContentBlock =
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'compaction'; content: string }
  | { type: 'server_tool_use'; id: string; name: string; input: Record<string, unknown> }
  | ServerToolResultBlock
  | { type: 'redacted_thinking'; data: string };

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
  server_tool_use: [name: string, input: Record<string, unknown>];
  server_tool_result: [name: string, result: unknown];
};
