
export type ToolUseAccumulator = {
  id: string;
  name: string;
  partialJson: string;
};

export type ToolUseResult = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type MessageStreamResult = {
  text: string;
  toolUses: ToolUseResult[];
  stopReason: string | null;
};

export type MessageStreamEvents = {
  message_start: [];
  message_text: [text: string];
  message_stop: [];
};
