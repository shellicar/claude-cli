import { type DurableConfig, IDurableConfigProvider, type ThinkingEffort } from '@shellicar/claude-sdk';

/**
 * A fixed, never-reloaded DurableConfig for a one-shot subagent query. QueryRunner only ever reads
 * `.config`; the rest of the interface exists for the app's own turn-setup code, which a subagent
 * has none of, so those methods are inert.
 */
export class StaticDurableConfigProvider extends IDurableConfigProvider {
  public constructor(private readonly value: DurableConfig) {
    super();
  }

  public get config(): DurableConfig {
    return this.value;
  }

  public update(): void {}
  public updateIdentityBody(): void {}
  public async resolveSystemPromptsFor(): Promise<void> {}
  public async resolveSkillCatalogue(): Promise<void> {}
  public needsSystemPromptResolve(): boolean {
    return false;
  }
  public getEffectiveModel(): string {
    return this.value.model;
  }
  public getEffectiveThinkingEnabled(): boolean {
    return this.value.thinking ?? false;
  }
  public getEffectiveEffort(): ThinkingEffort | undefined {
    return this.value.thinkingEffort;
  }
}
