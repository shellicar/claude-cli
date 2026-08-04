import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import type { ThinkingEffort } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { type CacheParameters, ModelSettings } from '../model/ModelSettings.js';
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
  // Each slot distinguishes "never set at runtime" (defer to the flag, then to what the
  // conversation last sent) from "cleared at runtime" (a deliberate null the operator chose).
  // Command mode reads, sets, and clears the same slots.
  #modelTouched = false;
  #thinkingTouched = false;
  #effortTouched = false;
  #cached: CacheParameters | null = null;

  /**
   * Precedence, highest first: a runtime change the operator just made, the `--model` launch flag,
   * then what this conversation last sent. A runtime change wins because it is the most recent
   * expression of intent, which is also what lets `C-/ m` back to the cached value clear a
   * divergence the flag introduced.
   *
   * The cached value only fills the slot when it actually differs from the config model. An
   * override slot means "not what the config says", and the status bar's `*` marks exactly that,
   * so a conversation cached on the config's own model must read as no override at all.
   */
  public get model(): string | null {
    if (this.#modelTouched) {
      return this.#model;
    }
    if (this.runtime.modelOverride != null) {
      return this.runtime.modelOverride;
    }
    const cached = this.#cached?.model ?? null;
    return cached !== this.configLoader.config.model ? cached : null;
  }

  public setModel(id: string | null): void {
    this.#model = id;
    this.#modelTouched = true;
    const override = this.model;
    const effective = override ?? this.configLoader.config.model;
    this.statusState.setModel(effective, override != null);
  }

  public get thinking(): 'on' | 'off' | null {
    if (this.#thinkingTouched) {
      return this.#thinking;
    }
    const cached = this.#cached;
    if (cached == null || cached.thinking === this.configLoader.config.thinking.enabled) {
      return null;
    }
    return cached.thinking ? 'on' : 'off';
  }

  public get effort(): ThinkingEffort | null {
    if (this.#effortTouched) {
      return this.#effort;
    }
    const cached = this.#cached?.effort ?? null;
    return cached !== (this.configLoader.config.thinking.effort ?? null) ? cached : null;
  }

  // Both cycles advance from the EFFECTIVE current value, not from the raw slot, so the first press
  // after resuming a conversation steps on from what that conversation was actually using rather
  // than restarting the cycle from its head.
  public cycleThinking(): void {
    const idx = THINKING_CYCLE.indexOf(this.thinking);
    this.#thinking = THINKING_CYCLE[(idx + 1) % THINKING_CYCLE.length] ?? null;
    this.#thinkingTouched = true;
    this.statusState.setThinkingOverride(this.#thinking);
  }

  public cycleEffort(): void {
    const idx = EFFORT_CYCLE.indexOf(this.effort);
    this.#effort = EFFORT_CYCLE[(idx + 1) % EFFORT_CYCLE.length] ?? null;
    this.#effortTouched = true;
    this.statusState.setEffortOverride(this.#effort);
  }

  public get cached(): CacheParameters | null {
    return this.#cached;
  }

  public markSent(params: CacheParameters): void {
    this.#cached = params;
  }

  public adopt(cached: CacheParameters | null): void {
    this.#cached = cached;
    this.#modelTouched = false;
    this.#thinkingTouched = false;
    this.#effortTouched = false;
    this.#syncStatus();
  }

  public carryOver(): void {
    this.#cached = null;
    this.#syncStatus();
  }

  #syncStatus(): void {
    const override = this.model;
    this.statusState.setModel(override ?? this.configLoader.config.model, override != null);
    this.statusState.setThinkingOverride(this.thinking);
    this.statusState.setEffortOverride(this.effort);
  }
}
