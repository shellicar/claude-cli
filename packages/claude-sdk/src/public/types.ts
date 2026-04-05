import type { MessagePort } from 'node:worker_threads';
import type { Model } from '@anthropic-ai/sdk/resources/messages';
import type { z } from 'zod';
import type { AnthropicBeta } from './enums';

export type ToolOperation = 'read' | 'write' | 'delete';

export type ToolDefinition<TSchema extends z.ZodType, TOutput = unknown> = {
  name: string;
  description: string;
  operation?: ToolOperation;
  input_schema: TSchema;
  input_examples: z.input<TSchema>[];
  handler: (input: z.output<TSchema>) => Promise<TOutput>;
};

export type AnyToolDefinition = {
  name: string;
  description: string;
  operation?: ToolOperation;
  input_schema: z.ZodType;
  input_examples: Record<string, unknown>[];
  handler: (input: never) => Promise<unknown>;
};

export type AnthropicBetaFlags = Partial<Record<AnthropicBeta, boolean>>;

export type CacheTtl = '5m' | '1h';

export type RunAgentQuery = {
  model: Model;
  thinking?: boolean;
  maxTokens: number;
  messages: string[];
  tools: AnyToolDefinition[];
  betas?: AnthropicBetaFlags;
  requireToolApproval?: boolean;
  pauseAfterCompact?: boolean;
  cacheTtl?: CacheTtl;
  /** Called with the raw tool output (pre-serialisation). Return value is serialised and stored in history. Use to ref-swap large values before they enter the context window. */
  transformToolResult?: (toolName: string, output: unknown) => unknown;
};

/** Messages sent from the SDK to the consumer via the MessagePort. */

export type SdkMessageStart = { type: 'message_start' };
export type SdkMessageText = { type: 'message_text'; text: string };
export type SdkMessageThinking = { type: 'message_thinking'; text: string };
export type SdkMessageCompactionStart = { type: 'message_compaction_start' };
export type SdkMessageCompaction = { type: 'message_compaction'; summary: string };
export type SdkMessageEnd = { type: 'message_end' };
export type SdkToolApprovalRequest = { type: 'tool_approval_request'; requestId: string; name: string; input: Record<string, unknown> };
export type SdkToolError = { type: 'tool_error'; name: string; input: Record<string, unknown>; error: string };
export type SdkDone = { type: 'done'; stopReason: string };
export type SdkError = { type: 'error'; message: string };
export type SdkMessageUsage = { type: 'message_usage'; inputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; outputTokens: number; costUsd: number; contextWindow: number };

export type SdkMessage = SdkMessageStart | SdkMessageText | SdkMessageThinking | SdkMessageCompactionStart | SdkMessageCompaction | SdkMessageEnd | SdkToolApprovalRequest | SdkToolError | SdkDone | SdkError | SdkMessageUsage;

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
  authToken: () => Promise<string>;
  logger?: ILogger;
  historyFile?: string;
};
