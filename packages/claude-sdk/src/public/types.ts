import type { MessagePort } from 'node:worker_threads';
import type { Model } from '@anthropic-ai/sdk/resources/messages';
import type { z } from 'zod';
import type { AnthropicBeta } from './enums';

export type ChainedToolStore = Map<string, unknown>;

export type ToolDefinition<TSchema extends z.ZodType, TOutput = unknown> = {
  name: string;
  description: string;
  input_schema: TSchema;
  input_examples: z.input<TSchema>[];
  handler: (input: z.output<TSchema>, store: ChainedToolStore) => Promise<TOutput>;
};

export type JsonValue = string | number | boolean | JsonObject | JsonValue[];
export type JsonObject = {
  [key: string]: JsonValue;
};

export type AnyToolDefinition = {
  name: string;
  description: string;
  input_schema: z.ZodType;
  input_examples: JsonObject[];
  handler: (input: never, store: ChainedToolStore) => Promise<unknown>;
};

export type AnthropicBetaFlags = Partial<Record<AnthropicBeta, boolean>>;

export type RunAgentQuery = {
  model: Model;
  maxTokens: number;
  messages: string[];
  tools: AnyToolDefinition[];
  betas?: AnthropicBetaFlags;
  requireToolApproval?: boolean;
};

/** Messages sent from the SDK to the consumer via the MessagePort. */

export type SdkMessageStart = { type: 'message_start' };
export type SdkMessageText = { type: 'message_text'; text: string };
export type SdkMessageEnd = { type: 'message_end' };
export type SdkToolApprovalRequest = { type: 'tool_approval_request'; requestId: string; name: string; input: Record<string, unknown> };
export type SdkDone = { type: 'done'; stopReason: string };
export type SdkError = { type: 'error'; message: string };

export type SdkMessage = SdkMessageStart | SdkMessageText | SdkMessageEnd | SdkToolApprovalRequest | SdkDone | SdkError;

/** Messages sent from the consumer to the SDK via the MessagePort. */
export type ConsumerMessage = { type: 'tool_approval_response'; requestId: string; approved: boolean; reason?: string } | { type: 'cancel' };

/** Returned by runAgent: port2 for the consumer, done resolves when the agent finishes. */
export type RunAgentResult = {
  port: MessagePort;
  done: Promise<void>;
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
  historyFile?: string;
};
