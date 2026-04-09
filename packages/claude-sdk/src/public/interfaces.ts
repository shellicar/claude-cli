import EventEmitter from 'node:events';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta.js';
import type { MessageStreamEvents, MessageStreamResult } from '../private/types';
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta.mjs';
import type { RunAgentQuery, RunAgentResult, ToolExecuteResult, TransformToolResult } from './types';

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

