import type { Model } from '@anthropic-ai/sdk/resources/messages';
import type { UUID } from 'node:crypto';
import type { z } from 'zod';

export type ChainedToolStore = Map<string, unknown>;

export type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  name: string;
  description: string;
  input_schema: z.ZodType<TInput>;
  input_examples: TInput[];
  handler: (input: TInput, store: ChainedToolStore) => TOutput;
};

export type JsonValue = string | number | boolean | JsonObject | JsonValue[];
export type JsonObject = {
  [key: string]: JsonValue
};

export type AnyToolDefinition = {
  name: string;
  description: string;
  input_schema: z.ZodType;
  input_examples: JsonObject[];
  handler: (input: never, store: ChainedToolStore) => unknown;
};

export enum AnthropicBeta {
  InterleavedThinking = 'interleaved-thinking-2025-05-14',
  ContextManagement = 'context-management-2025-06-27',
  PromptCachingScope = 'prompt-caching-scope-2026-01-05',
  Effort = 'effort-2025-11-24',
  AdvancedToolUse = 'advanced-tool-use-2025-11-20',
  ToolSearchTool = 'tool-search-tool-2025-10-19',
  TokenEfficientTools = 'token-efficient-tools-2026-03-28',
}

export type AnthropicBetaFlags = Partial<Record<AnthropicBeta, boolean>>;

export type RunAgentQuery = {
  model: Model;
  maxTokens: number;
  messages: string[];
  tools: AnyToolDefinition[];
  betas?: AnthropicBetaFlags;
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
  trace(message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
};

export type AnthropicAgentOptions = {
  apiKey: string;
  logger?: ILogger;
};
