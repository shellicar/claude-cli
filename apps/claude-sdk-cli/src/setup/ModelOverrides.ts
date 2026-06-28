import type { ThinkingEffort } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import { ModelSettings } from '../model/ModelSettings.js';
import { StatusState } from '../model/StatusState.js';
import { IRuntimeOptions } from './IRuntimeOptions.js';

const THINKING_CYCLE = [null, 'on', 'off'] as const;
const EFFORT_CYCLE: (ThinkingEffort | null)[] = [null, 'low', 'medium', 'high', 'xhigh', 'max'];

export class ModelOverrides extends ModelSettings {
  @dependsOn(IRuntimeOptions) private readonly runtime!: IRuntimeOptions;
  @dependsOn(StatusState) private readonly statusState!: StatusState;
  #thinking: 'on' | 'off' | null = null;
  #effort: ThinkingEffort | null = null;

  public get model(): string | null {
    return this.runtime.modelOverride;
  }

  public get thinking(): 'on' | 'off' | null {
    return this.#thinking;
  }

  public get effort(): ThinkingEffort | null {
    return this.#effort;
  }

  public cycleThinking(): void {
    const idx = THINKING_CYCLE.indexOf(this.#thinking);
    this.#thinking = THINKING_CYCLE[(idx + 1) % THINKING_CYCLE.length];
    this.statusState.setThinkingOverride(this.#thinking);
  }

  public cycleEffort(): void {
    const idx = EFFORT_CYCLE.indexOf(this.#effort);
    this.#effort = EFFORT_CYCLE[(idx + 1) % EFFORT_CYCLE.length] ?? null;
    this.statusState.setEffortOverride(this.#effort);
  }
}
