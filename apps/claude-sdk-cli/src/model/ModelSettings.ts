import type { ThinkingEffort } from '@shellicar/claude-sdk';

/**
 * The parameters a request was sent with, and the whole of what the prompt cache keys on, so a
 * divergence check is a comparison of two of these.
 *
 * These are resolved values, never override slots. An override slot is empty on a conversation
 * nobody has toggled anything on, and the cache is keyed on what was actually sent, not on whether
 * the operator chose it.
 */
export type CacheParameters = {
  model: string;
  thinking: boolean;
  effort: ThinkingEffort | null;
};

/**
 * The model-tuning settings the command mode drives, scoped to the conversation that owns them.
 * The model sub-mode recognises the t/e keys as intents; executing them — advancing the thinking
 * and effort overrides and landing the result in StatusState — is the implementation's job. The
 * implementation owns the cycle order; the executor only asks for the next step.
 *
 * These are the settings the prompt cache keys on, which is why they belong to the conversation
 * rather than to the process. A conversation resumed under a different model or effort than the
 * one its cached prefix was written with pays a full re-write of that prefix on its very next
 * request, however long the conversation is.
 */
export abstract class ModelSettings {
  public abstract cycleThinking(): void;
  public abstract cycleEffort(): void;
  /** Set or clear the per-session model override. `null` clears it, falling back
   * to the config model. Shares one slot with the `--model` startup flag. */
  public abstract setModel(id: string | null): void;

  public abstract get model(): string | null;
  public abstract get thinking(): 'on' | 'off' | null;
  public abstract get effort(): ThinkingEffort | null;

  /** What this conversation's cached prefix was written under, or null when it has sent nothing
   *  yet and so has no prefix to lose. */
  public abstract get cached(): CacheParameters | null;

  /**
   * Note the parameters a request is being sent with.
   *
   * Called before the request goes out rather than after it returns, because the API has already
   * processed the prefix and written the cache by the time a stream can be cut off. Recording on
   * the way out is what keeps an aborted turn counted.
   */
  public abstract markSent(params: CacheParameters): void;

  /** Take on what the conversation being adopted last sent, read back from its audit. Drops the
   *  runtime changes: they belonged to the conversation being left, and carrying them across is
   *  exactly the accidental invalidation this exists to prevent. */
  public abstract adopt(cached: CacheParameters | null): void;

  /** Move to a conversation with no history. The operator's runtime selection carries over, and
   *  there is no cached prefix yet, so there is nothing to diverge from. */
  public abstract carryOver(): void;
}
