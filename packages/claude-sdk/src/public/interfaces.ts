import EventEmitter from 'node:events';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta.js';
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { Conversation } from '../private/Conversation';
import type { MessageStreamEvents, MessageStreamResult } from '../private/types';
import type { DurableConfig, RunAgentQuery, RunAgentResult, ToolExecuteResult, TransformToolResult, TurnInput } from './types';

export abstract class IAnthropicAgent {
  public abstract runAgent(options: RunAgentQuery): RunAgentResult;
  public abstract getHistory(): BetaMessageParam[];
  public abstract loadHistory(messages: BetaMessageParam[]): void;
  /**
   * Inject a message into the conversation history with an optional tag.
   * Use `removeContext(id)` to prune it later (e.g. on skill deactivation).
   * Call between runs only — injecting during an active run is undefined behaviour.
   */
  public abstract injectContext(msg: BetaMessageParam, opts?: { id?: string }): void;
  /**
   * Remove a previously injected message by its tag.
   * Returns `true` if found and removed, `false` if no message with that id exists.
   */
  public abstract removeContext(id: string): boolean;
}

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
  public abstract process(stream: AsyncIterable<Anthropic.Beta.Messages.BetaRawMessageStreamEvent>): Promise<MessageStreamResult>;
}

/**
 * Long-lived tool registry. Holds tool definitions and executes them.
 *
 * Constructed once at consumer setup with the tool definitions. Converts each
 * tool's Zod schema to JSON Schema ONCE at construction and caches the
 * result: `wireTools` returns the cached wire-format representation for the
 * request builder, and `execute` uses the cached Zod schema for per-call
 * validation.
 *
 * `execute` does NOT construct the full `tool_result` block. Wrapping the
 * returned content with a `tool_use_id` is the query runner's job, because
 * only the query runner has seen the corresponding `tool_use` block in the
 * assistant message. The registry returns content only.
 *
 * The three error kinds in `ToolExecuteResult` (`not_found`, `invalid_input`,
 * `handler_error`) are distinguishable so the query runner can preserve the
 * current tool-not-found vs invalid-input channel-send asymmetry (Decision 3
 * in the session log).
 */
export abstract class IToolRegistry {
  public abstract get wireTools(): BetaToolUnion[];
  public abstract execute(name: string, input: unknown, transform?: TransformToolResult): Promise<ToolExecuteResult>;
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
