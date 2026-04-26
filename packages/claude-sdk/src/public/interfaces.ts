import EventEmitter from 'node:events';
import type { BetaMessageStream } from '@anthropic-ai/sdk/lib/BetaMessageStream.mjs';
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { Conversation } from '../private/Conversation';
import type { MessageStreamEvents, MessageStreamResult } from '../private/types';
import type { DurableConfig, PerQueryInput, ToolResolveResult, TurnInput } from './types';

/**
 * Long-lived stream processor. A concrete implementation is constructed once
 * at consumer setup, reused for every stream, and exposes `.on(...)` events
 * that the consumer subscribes to once at setup. Per-stream state lives in
 * the `process` method's local variables, not on the instance.
 *
 * Concurrent `process` calls on the same instance are not supported; the
 * intended usage is one call at a time.
 */
export abstract class IStreamProcessor extends EventEmitter<MessageStreamEvents> {
  public abstract process(stream: BetaMessageStream): Promise<MessageStreamResult>;
}

/**
 * Long-lived tool registry. Holds tool definitions, validates tool-use input,
 * and exposes the handler via a `run` closure returned from `resolve`.
 *
 * Constructed once at consumer setup with the tool definitions. Converts each
 * tool's Zod schema to JSON Schema ONCE at construction and caches the
 * result: `wireTools` returns the cached wire-format representation for the
 * request builder, and `resolve` uses the cached Zod schema for per-call
 * validation.
 *
 * `resolve` is a two-phase API, split so the query runner can gate handler
 * execution on approval without a second `safeParse`:
 *
 * 1. Caller invokes `resolve(name, input)`. The registry looks the tool up,
 *    parses the input against the Zod schema, and returns either an error
 *    (`not_found` or `invalid_input`) or a `ready` result carrying a `run`
 *    closure. The closure captures the parsed input at this point.
 * 2. The query runner holds the `run` closure across the approval gate and,
 *    once approval has settled, invokes it with the optional transform hook.
 *    The handler is called with the parsed input directly; no second parse.
 *
 * The registry does NOT construct full `tool_result` blocks. Wrapping the
 * `ToolRunResult` content with a `tool_use_id` is the query runner's job,
 * because only the query runner has seen the corresponding `tool_use` block.
 *
 * The two error kinds from `resolve` (`not_found`, `invalid_input`) plus the
 * `handler_error` kind from `run` are distinguishable so the query runner can
 * preserve the tool-not-found vs invalid-input channel-send asymmetry
 * (Decision 3 in the session log).
 */
export abstract class IToolRegistry {
  public abstract get wireTools(): BetaTool[];
  public abstract resolve(name: string, input: unknown): ToolResolveResult;
}

/**
 * Long-lived turn runner. Runs one request-and-response cycle between the
 * SDK and the Anthropic API per call to `run`.
 *
 * Constructed once at consumer setup with its dependencies (an `IMessageStreamer`
 * and an `IStreamProcessor`). Reused for every turn of every query. Does NOT
 * subscribe or unsubscribe to any events per turn: the `.on(...)` handlers on
 * the injected `IStreamProcessor` are set once at setup and fire naturally for
 * every turn this runner processes.
 *
 * The runner:
 * - Reads the wire view from `Conversation.cloneForRequest()`.
 * - Calls the pure `buildRequestParams` function to produce `{ body, headers }`.
 * - Merges the per-turn abort signal into the request options.
 * - Calls the streamer to get the raw event iterable.
 * - Hands the iterable to the processor and awaits the assembled result.
 * - Pushes the assembled assistant message into the `Conversation` when the
 *   content is non-empty.
 * - Returns the full `MessageStreamResult` so the query runner can read
 *   `stopReason`, `blocks` (for tool dispatch), and `usage` (for the channel).
 *
 * Does NOT dispatch tools, construct `tool_result` messages, or decide whether
 * to loop: those are the query runner's responsibilities. Holds no per-turn
 * state on the instance; everything per-turn lives in `run`'s local variables.
 */
export abstract class ITurnRunner {
  public abstract run(conversation: Conversation, durable: DurableConfig, turnInput: TurnInput): Promise<MessageStreamResult>;
}

/**
 * Long-lived query runner. Runs one query per call to `run`. A query is one
 * user ask turned into however many turns the model needs to answer it.
 *
 * Constructed once at consumer setup with its dependencies (`ITurnRunner`, a
 * `Conversation`, an `IToolRegistry`, an `ApprovalCoordinator`, an `IControlChannel`,
 * and the long-lived `DurableConfig`). Reused for every query. Holds no
 * per-query state on the instance; per-query state lives in `run`'s local
 * variables.
 *
 * The query runner owns:
 * - Pushing the per-query user messages into the `Conversation`, with
 *   `cachedReminders` injection on a fresh or post-compaction conversation.
 * - The turn loop: calls `ITurnRunner.run` until a terminal stop reason or a
 *   cancel. Threads the one-shot `systemReminder` into the first turn only.
 * - Tool dispatch between turns: resolves each `tool_use` via the registry,
 *   sends approval requests over the control channel if required, and
 *   invokes the `run` closure once approval has settled. Preserves the
 *   tool-not-found vs invalid-input asymmetry: `not_found` is logged
 *   silently, `invalid_input` broadcasts on the control channel.
 * - Sending `query_summary`, `message_usage`, `done`, and `error` on the
 *   control channel.
 *
 * The query runner does NOT close the control channel. The channel is
 * long-lived and owned by the consumer; closing it per query would break
 * every subsequent query on the same SDK instance.
 */
export abstract class IQueryRunner {
  public abstract run(input: PerQueryInput): Promise<void>;
}
