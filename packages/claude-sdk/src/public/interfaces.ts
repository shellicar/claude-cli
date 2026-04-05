import type { ContextMessage, JsonObject, RunAgentQuery, RunAgentResult } from './types';

export abstract class IAnthropicAgent {
  public abstract runAgent(options: RunAgentQuery): RunAgentResult;
  public abstract getHistory(): JsonObject[];
  public abstract loadHistory(messages: JsonObject[]): void;
  /**
   * Inject a message into the conversation history with an optional tag.
   * Use `removeContext(id)` to prune it later (e.g. on skill deactivation).
   * Call between runs only — injecting during an active run is undefined behaviour.
   */
  public abstract injectContext(msg: ContextMessage, opts?: { id?: string }): void;
  /**
   * Remove a previously injected message by its tag.
   * Returns `true` if found and removed, `false` if no message with that id exists.
   */
  public abstract removeContext(id: string): boolean;
}
