import type { ThinkingEffort } from '@shellicar/claude-sdk';

/** The model, thinking and effort a request was built with. Every field the prompt cache keys on
 *  and nothing else, so a divergence check is a comparison of two of these. */
export type CacheParameters = {
  model: string | null;
  thinking: 'on' | 'off' | null;
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
 * request, however long the conversation is. `record` and `load` are what keep the two in step.
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

  /** Adopt the settings this conversation last made a request under, clearing any runtime change
   *  made against the conversation being left. A conversation that has never made a request
   *  restores nothing and falls back to the flags and config. */
  public abstract load(conversationId: string): void;

  /** A new conversation keeps whatever the operator currently has selected, but starts with nothing
   *  recorded: it has no cached prefix yet, so there is nothing to diverge from. */
  public abstract inherit(): void;

  /** Remember the settings a request was just made under. This is what the cached prefix was
   *  written with, so it is both what a resume restores and what a divergence is measured against. */
  public abstract record(conversationId: string): void;

  /** The settings the current cached prefix was written under, or null when this conversation has
   *  not made a request yet and so has nothing cached to lose. */
  public abstract get recorded(): CacheParameters | null;
}
