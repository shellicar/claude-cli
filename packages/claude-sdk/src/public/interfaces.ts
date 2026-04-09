import EventEmitter from 'node:events';
import type { Anthropic } from '@anthropic-ai/sdk';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta.js';
import type { MessageStreamEvents, MessageStreamResult } from '../private/types';
import type { RunAgentQuery, RunAgentResult } from './types';

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
