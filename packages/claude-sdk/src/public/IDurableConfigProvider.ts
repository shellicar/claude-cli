import type { DurableConfig, ThinkingEffort } from './types';

/**
 * The durable-config contract `QueryRunner` resolves so it can read the current
 * config (derived on read from the live in-memory state) without importing the
 * consumer's concrete factory. The consumer's `DurableConfigFactory` implements it.
 */
export abstract class IDurableConfigProvider {
  public abstract get config(): DurableConfig;
  public abstract update(claudeMdContent?: string | null): void;
  public abstract resolveSystemPromptsFor(sessionId: string): Promise<void>;
  public abstract needsSystemPromptResolve(sessionId: string): boolean;
  public abstract getEffectiveModel(): string;
  public abstract getEffectiveThinkingEnabled(): boolean;
  public abstract getEffectiveEffort(): ThinkingEffort | undefined;
}
