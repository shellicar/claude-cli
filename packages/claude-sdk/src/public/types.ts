import type { Model } from '@anthropic-ai/sdk/resources/messages';
import type { UUID } from 'node:crypto';

export type ToolDefinition = {
  name: string,
  description: string,
  input_schema: object,
  handler: () => object | string,
};

export type RunAgentQuery = {
  model: Model;
  messages: string[];
  tools: ToolDefinition[]
};

export type AgentEvents = {
  message_start: [];
  message_text: [text: string];
  message_end: [];

  tool_use: [name: string, input: Record<string, unknown>];
  session_id: [sessionId: UUID];
  done: [stopReason: string];
  error: [err: Error];
};

export type ILogger = {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
};

export type AnthropicAgentOptions = {
  apiKey: string;
  logger?: ILogger;
};
