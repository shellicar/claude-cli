import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaBase64ImageSource, BetaBase64PDFSource, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { Model } from '@anthropic-ai/sdk/resources/messages';
import type { z } from 'zod';
import type { Sender } from '../private/Conversation';
import type { AnthropicBeta, CacheTtl } from './enums';

// 'escalate' is distinct from 'write': a write's risk is scoped by the cwd-zone matrix (default/
// outside), which a config can set to auto-approve (e.g. autoApproveEdits). Escalate is for a tool
// that crosses a privilege boundary no zone or config auto-approve should ever cover — it always
// asks, unconditionally (see permissions.ts getPermission). Not part of the configurable matrix.
export type ToolOperation = 'read' | 'write' | 'delete' | 'escalate';

export type ToolHandlerResult<TOutput = unknown> = {
  textContent: TOutput;
  attachments?: ToolAttachmentBlock[];
};

export type ToolHandler<TInput = unknown, TOutput = unknown> = (input: TInput, signal?: AbortSignal) => Promise<ToolHandlerResult<TOutput>>;

/** A tool's hook into the managed per-block server lifecycle. A tool that owns
 * a resource scoped to one tool-execution block (e.g. an on-demand child
 * process) sets this on its definition; `blockEnded` runs once after the block
 * that used it finishes, tearing the resource down. Structural: any object with
 * this method satisfies it, so a class already extending another abstract (the
 * tsserver bridge) can still provide it. */
export type ToolBlockLifetime = {
  blockEnded(): Promise<void>;
};

export type ToolDefinition<TSchema extends z.ZodType, TOutputSchema extends z.ZodType> = {
  name: string;
  description: string;
  operation?: ToolOperation;
  input_schema: TSchema;
  output_schema: TOutputSchema;
  defer_loading?: boolean;
  input_examples: z.input<TSchema>[];
  handler: ToolHandler<z.output<TSchema>, z.output<TOutputSchema>>;
  /** Set when this tool owns a resource scoped to one tool-execution block. The
   *  build-tools step collects every tool that sets it and tears the resource
   *  down once per block, deduped by identity. */
  blockLifetime?: ToolBlockLifetime;
};

export type AnyToolDefinition = {
  name: string;
  description: string;
  operation?: ToolOperation;
  input_schema: z.ZodType;
  output_schema: z.ZodType;
  defer_loading?: boolean;
  input_examples: Record<string, unknown>[];
  /**
   * `never` is intentional. Function parameters are contravariant: `ToolHandler<SpecificInput>` is
   * assignable to `ToolHandler<never>` because `never` is a subtype of every type. Using `unknown`
   * here would break that — `ToolDefinition<TSchema, TOut>` could no longer be assigned to
   * `AnyToolDefinition`. The call site in `ToolRegistry` casts to `ToolHandler<unknown>` at the
   * erase boundary when it actually invokes the handler.
   */
  handler: ToolHandler<never>;
  blockLifetime?: ToolBlockLifetime;
};

export type AnthropicBetaFlags = Partial<Record<AnthropicBeta, boolean>>;

/** Called with the raw tool output (pre-serialisation). Return value is serialised and stored in history. Use to ref-swap large values before they enter the context window. */
export type TransformToolResult = (toolName: string, output: unknown) => unknown;

/** Narrowed block types covering only the base64 source variants this SDK constructs. */
export type DocumentBlock = { type: 'document'; source: BetaBase64PDFSource };
export type ImageBlock = { type: 'image'; source: BetaBase64ImageSource };
export type TextBlock = { type: 'text'; text: string };
export type ToolAttachmentBlock = DocumentBlock | ImageBlock;
export type ToolResultBlockContent = TextBlock | DocumentBlock | ImageBlock;

/** The shape of a tool result block as built by the SDK and pushed into the conversation. */
export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  is_error?: true;
  content?: ToolResultBlockContent[];
};

/** A tool dispatch outcome. One taxonomy for every terminal result, keyed by what the
 * caller should do rather than by which phase noticed it.
 *
 * - `ok`          the handler returned a value.
 * - `rejected`    the request was malformed or illegal (schema validation failed) — fix and retry.
 * - `refused`     a well-formed request disallowed by policy (a `ToolRefusedError`) — non-retryable, escalate to the user.
 * - `unavailable` no tool by that name.
 * - `failed`      the handler threw unexpectedly.
 * - `cancelled`   the user aborted the run.
 */
export type ToolOutcome = { kind: 'ok'; content: string; blocks?: ToolAttachmentBlock[] } | { kind: 'rejected'; reason: string } | { kind: 'refused'; reason: string } | { kind: 'unavailable'; name: string } | { kind: 'failed'; error: string } | { kind: 'cancelled'; elapsedMs: number };

/** Result of running a resolved tool's handler — the outcomes possible once input has
 * already validated: a value, a policy refusal, an unexpected crash, or a cancel. */
export type ToolRunResult = Extract<ToolOutcome, { kind: 'ok' | 'refused' | 'failed' | 'cancelled' }>;

/** Result of `IToolRegistry.resolve`. Either `ready` (hold the `run` closure across the
 * approval gate and invoke it once approval settles) or a terminal outcome resolve can
 * produce on its own: `unavailable` (no such tool) or `rejected` (bad input). The closure
 * captures the parsed input at resolve time; there is no second `safeParse` before run. */
export type ToolResolveResult = { kind: 'ready'; run: (transform?: TransformToolResult, signal?: AbortSignal) => Promise<ToolRunResult> } | Extract<ToolOutcome, { kind: 'unavailable' | 'rejected' }>;

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

export type ThinkingEffort = 'max' | 'xhigh' | 'high' | 'medium' | 'low';

export type DurableConfig = {
  model: Model;
  thinking?: boolean;
  thinkingEffort?: ThinkingEffort;
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

/** A `<system-reminder>` block bound to a user message, described by two orthogonal axes.
 *
 * `persisted` — when true, the block is written into conversation history and so is present
 * on every later turn and query for free; it is injected ONCE per query. When false, the block
 * is added to the per-request clone only and must be re-injected EVERY turn, or an un-persisted
 * reminder (e.g. the clock stamp) would show on the user message and vanish on the model's own
 * turns.
 *
 * `position` — `leading` sits before the user's text (inside the moving cache prefix, so it is
 * cached); `trailing` sits after it (past the cache boundary, so it is not). Placement follows
 * from `persisted`: persisted-leading reminders are injected into history by the query runner;
 * ephemeral ones are appended to the request clone by the request builder.
 */
export type SystemReminder = {
  text: string;
  persisted: boolean;
  position: 'leading' | 'trailing';
};

/** Per-turn runtime input passed to `ITurnRunner.run`.
 *
 * `ephemeralReminders` are the non-persisted `<system-reminder>` blocks for this turn (e.g. the
 * git delta on the first turn, the clock stamp on every turn). The request builder appends them
 * to the clone; they never enter history. The query runner passes the query's ephemeral reminders
 * on the first turn only and none on subsequent turns.
 *
 * `abortSignal` is threaded into the request options so the HTTP call can be cancelled. The
 * query runner passes the same signal on every turn of a query.
 */
export type TurnInput = {
  ephemeralReminders?: SystemReminder[];
  abortSignal: AbortSignal;
};

/** Per-query runtime input passed to `IQueryRunner.run`.
 *
 * `messages` are the user messages for this query. Multiple entries become consecutive
 * user messages; the `Conversation` merges adjacent user messages into one per the
 * API's alternation rules.
 *
 * `reminders` are the `<system-reminder>` blocks for this query. Persisted-leading ones are
 * prepended to the query's opening user message and stored in history (once per query);
 * ephemeral ones are threaded into the first turn and appended to the request clone.
 *
 * `transformToolResult` is an optional per-query hook applied to each tool's raw output
 * before it is stringified and sent back to the model. Use to ref-swap large values.
 *
 * `abortController` is a fresh controller per query. The query runner threads its signal
 * into every turn so the in-flight HTTP call can be cancelled.
 */
export type PerQueryInput = {
  messages: (string | Anthropic.Beta.Messages.BetaMessageParam)[];
  reminders?: SystemReminder[];
  transformToolResult?: TransformToolResult;
  abortController: AbortController;
  /** Present when the query was accepted from a wire `say`: the already-returned queryId and the
   *  sender to echo as `from` on the committed user message. Absent for keyboard input, where the
   *  queryId is minted in QueryRunner and `from` defaults to `{ kind: 'human' }`. */
  queryId?: string;
  from?: Sender;
};

/** Messages sent from the SDK to the consumer. */
export type SdkMessageStart = { type: 'message_start' };
export type SdkMessageText = { type: 'message_text'; text: string };
export type SdkMessageThinking = { type: 'message_thinking'; text: string };
export type SdkMessageCompactionStart = { type: 'message_compaction_start' };
export type SdkMessageCompaction = { type: 'message_compaction'; summary: string };
export type SdkMessageEnd = { type: 'message_end'; stopReason: string };
export type SdkToolApprovalRequest = { type: 'tool_approval_request'; requestId: string; name: string; input: Record<string, unknown> };
export type SdkServerToolUse = { type: 'server_tool_use'; id: string; name: string; input: Record<string, unknown> };
export type SdkServerToolResult = { type: 'server_tool_result'; id: string; name: string; result: unknown };
/** A client tool's result, published as the query runner builds the tool_result block. `content` is post-transform (ref-swapped for large outputs). The history view reads this to show the output the model saw. `cancelled` distinguishes a user-aborted run from any other error, so the consumer can render it distinctly from a genuine failure. */
export type SdkToolResult = { type: 'tool_result'; id: string; content: string; isError: boolean; cancelled: boolean };
export type SdkToolUseStart = { type: 'tool_use_start'; id: string; name: string };
export type SdkServerToolUseStart = { type: 'server_tool_use_start'; id: string; name: string };
export type SdkToolUseInputDelta = { type: 'tool_use_input_delta'; id: string; partialJson: string };
export type SdkToolUseInputStop = { type: 'tool_use_input_stop'; id: string; input: Record<string, unknown> };

export type SdkToolError = { type: 'tool_error'; name: string; input: Record<string, unknown>; error: string };
/** Published the moment ESC aborts a running tool batch's controller — before the handler has
 * actually unwound. Carries no id: one abort cancels every tool still running in the batch, so the
 * consumer marks every non-terminal tool in the active batch as cancelling rather than one by id. */
export type SdkToolCancelling = { type: 'tool_cancelling' };
export type SdkDone = { type: 'done'; stopReason: string };
export type SdkBlockEnter = { type: 'block_enter'; blockType: string };
export type SdkBlockExit = { type: 'block_exit'; blockType: string };
export type SdkToolBatchStart = { type: 'tool_batch_start' };
export type SdkToolBatchEnd = { type: 'tool_batch_end' };
/** Brackets tool execution. Emitted around the tool-time clock in the query runner:
 * tool_exec_start when the batch begins running (after the assistant message and its
 * usage are done), tool_exec_end when every tool has settled. The span covers approval
 * waits and batches where nothing runs. */
export type SdkToolExecStart = { type: 'tool_exec_start' };
export type SdkToolExecEnd = { type: 'tool_exec_end' };
/** The structured pieces of an API failure the CLI formats for display. Present when the
 * error is a transport error carrying a parsed body; absent for errors that have only a
 * message (e.g. an internal give-up). `message` is the human-readable detail from the
 * response body, falling back to the error's own message when the body carried none. */
export type SdkErrorDetail = { status?: number; type?: string; message: string };
export type SdkError = { type: 'error'; message: string; detail?: SdkErrorDetail };
export type SdkMessageUsage = { type: 'message_usage'; inputTokens: number; cacheCreationTokens: number; cacheCreation5mTokens: number; cacheCreation1hTokens: number; cacheReadTokens: number; outputTokens: number; costUsd: number; contextWindow: number };
export type SdkQuerySummary = { type: 'query_summary'; systemPrompts: number; userMessages: number; assistantMessages: number; thinkingBlocks: number; systemReminder?: string };

export type SdkTurnContent = { type: 'turn_content'; blocks: ContentBlock[] };

export type SdkMessage =
  | SdkBlockEnter
  | SdkBlockExit
  | SdkToolBatchStart
  | SdkToolBatchEnd
  | SdkToolExecStart
  | SdkToolExecEnd
  | SdkMessageStart
  | SdkMessageText
  | SdkMessageThinking
  | SdkMessageCompactionStart
  | SdkMessageCompaction
  | SdkMessageEnd
  | SdkToolApprovalRequest
  | SdkServerToolUse
  | SdkServerToolResult
  | SdkToolResult
  | SdkToolUseStart
  | SdkServerToolUseStart
  | SdkToolUseInputDelta
  | SdkToolUseInputStop
  | SdkToolError
  | SdkToolCancelling
  | SdkDone
  | SdkError
  | SdkMessageUsage
  | SdkQuerySummary
  | SdkTurnContent;

/** Messages sent from the consumer to the SDK. */
export type ConsumerMessage = { type: 'tool_approval_response'; requestId: string; approved: boolean; reason?: string } | { type: 'cancel' };

/** Receives account-limit retry signals from the transport's retry loop. The
 * consumer implements this to display a notice. `retrying` fires on each capped
 * 429 retry, `stopped` on give-up. */
export abstract class AccountLimitListener {
  public abstract retrying(): void;
  public abstract stopped(): void;
}

/** A held wake lock. `release` is idempotent and never throws. */
export type WakeLockHandle = {
  release(): void;
};

/** Receives stream-interruption retry signals from TurnRunner's retry loop. The
 * consumer implements it to seal the partial reply and show a reconnect notice.
 * `reconnecting` fires once per retry attempt, before the re-issue. */
export abstract class StreamInterruptListener {
  public abstract reconnecting(): void;
}

/** Receives the request layer's clock edges from TurnRunner's retry loop. One
 * `requestStarted` per attempt that goes in flight; `requestSettled(kept)` when
 * that attempt settles — `kept` is true only for a 2xx (a completed
 * `processor.process`). The consumer's clock charges `claude` only on a kept
 * settle; every non-kept attempt, and the backoff waits between attempts, are
 * Unknown. */
export abstract class IRequestClockListener {
  public abstract requestStarted(): void;
  public abstract requestSettled(kept: boolean): void;
}

/** Receives the tools layer's clock edges from QueryRunner's dispatch. One
 * `toolsStarted` at the first local tool execution of a batch, one
 * `toolsStopped` after the last returns. The clock runs from the first tool to
 * the last; pauses between tools in the same batch count as tools time too. */
export abstract class IToolsClockListener {
  public abstract toolsStarted(): void;
  public abstract toolsStopped(): void;
}

/** The pipeline's tool-block end edge. QueryRunner calls `blockEnded()` once
 * after each tool batch finishes — normal return, thrown error, or a batch
 * where nothing ran. The concrete fans the edge out to every tool that declared
 * a `blockLifetime`; the pipeline neither knows nor names what is subscribed,
 * exactly as it notifies IToolsClockListener without knowing the clock. A
 * fan-out over a list — never bound to one tool implementation. */
export abstract class IToolBlockNotifier {
  public abstract blockEnded(): Promise<void>;
}

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
