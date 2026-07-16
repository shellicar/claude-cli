import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
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
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  #thinking: 'on' | 'off' | null = null;
  #effort: ThinkingEffort | null = null;
  #model: string | null = null;
  // Distinguishes "never set at runtime" (fall back to the --model flag) from
  // "cleared at runtime" (fall back to the config model). One override slot,
  // seeded by --model; command mode reads, sets, and clears the same slot.
  #modelTouched = false;

  public get model(): string | null {
    return this.#modelTouched ? this.#model : this.runtime.modelOverride;
  }

  public setModel(id: string | null): void {
    this.#model = id;
    this.#modelTouched = true;
    const override = this.model;
    const effective = override ?? this.configLoader.config.model;
    this.statusState.setModel(effective, override != null);
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
