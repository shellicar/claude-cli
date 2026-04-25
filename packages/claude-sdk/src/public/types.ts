import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaImageBlockParam, BetaRequestDocumentBlock, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { Model } from '@anthropic-ai/sdk/resources/messages';
import type { z } from 'zod';
import type { AnthropicBeta, CacheTtl } from './enums';

export type ToolOperation = 'read' | 'write' | 'delete';

export type ToolDefinition<TSchema extends z.ZodType, TOutputSchema extends z.ZodType> = {
  name: string;
  description: string;
  operation?: ToolOperation;
  input_schema: TSchema;
  output_schema: TOutputSchema;
  defer_loading?: boolean;
  input_examples: z.input<TSchema>[];
  handler: (input: z.output<TSchema>) => Promise<{
    textContent: z.output<TOutputSchema>;
    attachments?: ToolAttachmentBlock[];
  }>;
};

export type AnyToolDefinition = {
  name: string;
  description: string;
  operation?: ToolOperation;
  input_schema: z.ZodType;
  output_schema: z.ZodType;
  defer_loading?: boolean;
  input_examples: Record<string, unknown>[];
  handler: (input: never) => Promise<{
    textContent: unknown;
    attachments?: ToolAttachmentBlock[];
  }>;
};

export type AnthropicBetaFlags = Partial<Record<AnthropicBeta, boolean>>;

/** Called with the raw tool output (pre-serialisation). Return value is serialised and stored in history. Use to ref-swap large values before they enter the context window. */
export type TransformToolResult = (toolName: string, output: unknown) => unknown;

/** Block types valid inside `tool_result.content` alongside a text block. */
export type ToolAttachmentBlock = BetaRequestDocumentBlock | BetaImageBlockParam;

/** Result of running a resolved tool's handler.
 *
 * Returned by the `run` closure on a `ToolResolveResult` of kind `'ready'`. Covers only
 * the two outcomes that are possible once input validation has already succeeded: the
 * handler returned a value, or the handler threw.
 */
export type ToolRunResult =
  | { kind: 'success'; content: string; blocks?: ToolAttachmentBlock[] }
  | { kind: 'handler_error'; error: string };

/** Result of `IToolRegistry.resolve`.
 *
 * The caller branches on `kind` to preserve the tool-not-found vs invalid-input
 * channel-send asymmetry (see `.claude/sessions/2026-04-10.md`, Decision 3). `not_found`
 * is logged silently; `invalid_input` is broadcast on the control channel.
 *
 * On kind `'ready'`, the caller holds the returned `run` closure across the approval
 * gate and invokes it once approval has settled. The closure captures the parsed input
 * at resolve time: there is no second `safeParse` between resolve and run. The query
 * runner's `#handleTools` parses each `tool_use` input once up front and threads the
 * parsed value through the approval machinery to the handler.
 */
export type ToolResolveResult = { kind: 'ready'; run: (transform?: TransformToolResult) => Promise<ToolRunResult> } | { kind: 'not_found' } | { kind: 'invalid_input'; error: string };

/** The durable, long-lived configuration the consumer holds once and reuses across queries.
 *
 * Constructed by the consumer at SDK setup and passed into each `IQueryRunner.run` call
 * (and, via the query runner, into `ITurnRunner.run`). Contains everything the request
 * builder needs plus the query-level policy fields (`requireToolApproval`, `cachedReminders`)
 * that the query runner uses.
 *
 * Does NOT contain per-query inputs: the user message list, `transformToolResult`, or the
 * one-shot `systemReminder`. Those are supplied per call, not held across queries.
 */
export type CompactConfig = {
  enabled: boolean;
  inputTokens: number;
  pauseAfterCompaction: boolean;
  customInstructions?: string;
};

export type DurableConfig = {
  model: Model;
  thinking?: boolean;
  maxTokens: number;
  systemPrompts?: string[];
  tools: AnyToolDefinition[];
  /** Server-side tools (e.g. search, web fetch) prepended to the wire tools array before client tools. The caller constructs these directly from Anthropic SDK types. */
  serverTools?: BetaToolUnion[];
  /** Applied to each client tool after `toWireTool` converts it. Use to add ATU-specific fields (defer_loading, allowed_callers, input_examples) without the SDK needing to know about them. Not called for serverTools. */
  transformTool?: (tool: BetaToolUnion) => BetaToolUnion;
  betas?: AnthropicBetaFlags;
  requireToolApproval?: boolean;
  compact?: CompactConfig;
  cacheTtl?: CacheTtl;
  cachedReminders?: string[];
};

/** Per-turn runtime input passed to `ITurnRunner.run`.
 *
 * `systemReminder` is a one-shot ephemeral string injected into the last user message for
 * this turn only. The query runner passes it on the first turn of a query and `undefined`
 * on subsequent turns.
 *
 * `abortSignal` is threaded into the request options so the HTTP call can be cancelled. The
 * query runner passes the same signal on every turn of a query.
 */
export type TurnInput = {
  systemReminder?: string;
  abortSignal: AbortSignal;
};

/** Per-query runtime input passed to `IQueryRunner.run`.
 *
 * `messages` are the user messages for this query. Multiple entries become consecutive
 * user messages; the `Conversation` merges adjacent user messages into one per the
 * API's alternation rules.
 *
 * `systemReminder` is a one-shot ephemeral string used on the first turn only. The
 * query runner resets it to `undefined` after the first turn.
 *
 * `transformToolResult` is an optional per-query hook applied to each tool's raw output
 * before it is stringified and sent back to the model. Use to ref-swap large values.
 *
 * `abortController` is a fresh controller per query. The query runner threads its signal
 * into every turn so the in-flight HTTP call can be cancelled.
 */
export type PerQueryInput = {
  messages: (string | Anthropic.Beta.Messages.BetaMessageParam)[];
  systemReminder?: string;
  transformToolResult?: TransformToolResult;
  abortController: AbortController;
};

/** Messages sent from the SDK to the consumer via the MessagePort. */
export type SdkMessageStart = { type: 'message_start' };
export type SdkMessageText = { type: 'message_text'; text: string };
export type SdkMessageThinking = { type: 'message_thinking'; text: string };
export type SdkMessageCompactionStart = { type: 'message_compaction_start' };
export type SdkMessageCompaction = { type: 'message_compaction'; summary: string };
export type SdkMessageEnd = { type: 'message_end' };
export type SdkToolApprovalRequest = { type: 'tool_approval_request'; requestId: string; name: string; input: Record<string, unknown> };
export type SdkServerToolUse = { type: 'server_tool_use'; name: string; input: Record<string, unknown> };
export type SdkServerToolResult = { type: 'server_tool_result'; name: string; result: unknown };
export type SdkToolError = { type: 'tool_error'; name: string; input: Record<string, unknown>; error: string };
export type SdkDone = { type: 'done'; stopReason: string };
export type SdkError = { type: 'error'; message: string };
export type SdkMessageUsage = { type: 'message_usage'; inputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; outputTokens: number; costUsd: number; contextWindow: number };
export type SdkQuerySummary = { type: 'query_summary'; systemPrompts: number; userMessages: number; assistantMessages: number; thinkingBlocks: number; systemReminder?: string };

export type SdkMessage = SdkMessageStart | SdkMessageText | SdkMessageThinking | SdkMessageCompactionStart | SdkMessageCompaction | SdkMessageEnd | SdkToolApprovalRequest | SdkServerToolUse | SdkServerToolResult | SdkToolError | SdkDone | SdkError | SdkMessageUsage | SdkQuerySummary;

/** Messages sent from the consumer to the SDK via the MessagePort. */
export type ConsumerMessage = { type: 'tool_approval_response'; requestId: string; approved: boolean; reason?: string } | { type: 'cancel' };

export type ILogger = {
  trace(message: string, ...meta: unknown[]): void;
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
};
