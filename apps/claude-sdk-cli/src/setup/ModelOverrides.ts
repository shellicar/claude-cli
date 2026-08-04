import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IObjectStore } from '@shellicar/claude-core/persistence/interfaces';
import type { ThinkingEffort } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { type CacheParameters, ModelSettings } from '../model/ModelSettings.js';
import { StatusState } from '../model/StatusState.js';
import { IRuntimeOptions } from './IRuntimeOptions.js';

const THINKING_CYCLE = [null, 'on', 'off'] as const;
const EFFORT_CYCLE: (ThinkingEffort | null)[] = [null, 'low', 'medium', 'high', 'xhigh', 'max'];

/** The `objects` collection holding each conversation's last-used cache parameters, keyed by conversation id. */
export const MODEL_SETTINGS_COLLECTION = 'model-settings';

export class ModelOverrides extends ModelSettings {
  @dependsOn(IRuntimeOptions) private readonly runtime!: IRuntimeOptions;
  @dependsOn(StatusState) private readonly statusState!: StatusState;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(IObjectStore) private readonly objects!: IObjectStore;
  #thinking: 'on' | 'off' | null = null;
  #effort: ThinkingEffort | null = null;
  #model: string | null = null;
  // Each slot distinguishes "never set at runtime" (defer to the flag, then to what the
  // conversation last used) from "cleared at runtime" (a deliberate null the operator chose).
  // Command mode reads, sets, and clears the same slots.
  #modelTouched = false;
  #thinkingTouched = false;
  #effortTouched = false;
  #recorded: CacheParameters | null = null;

  /** Precedence, highest first: a runtime change the operator just made, the `--model` launch flag,
   *  then what this conversation last made a request under. A runtime change wins because it is the
   *  most recent expression of intent, which is also what lets `C-/ m` back to the recorded value
   *  clear a divergence the flag introduced. */
  public get model(): string | null {
    if (this.#modelTouched) {
      return this.#model;
    }
    return this.runtime.modelOverride ?? this.#recorded?.model ?? null;
  }

  public setModel(id: string | null): void {
    this.#model = id;
    this.#modelTouched = true;
    const override = this.model;
    const effective = override ?? this.configLoader.config.model;
    this.statusState.setModel(effective, override != null);
  }

  public get thinking(): 'on' | 'off' | null {
    return this.#thinkingTouched ? this.#thinking : (this.#recorded?.thinking ?? null);
  }

  public get effort(): ThinkingEffort | null {
    return this.#effortTouched ? this.#effort : (this.#recorded?.effort ?? null);
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

  public get recorded(): CacheParameters | null {
    return this.#recorded;
  }

  public load(conversationId: string): void {
    const raw = this.objects.get(MODEL_SETTINGS_COLLECTION, conversationId);
    this.#recorded = raw == null ? null : (JSON.parse(raw) as CacheParameters);
    // Drop every runtime change: they belonged to the conversation being left, and carrying them
    // into this one is exactly the accidental divergence this class exists to prevent.
    this.#modelTouched = false;
    this.#thinkingTouched = false;
    this.#effortTouched = false;
    this.#syncStatus();
  }

  public inherit(): void {
    // Deliberately keeps the runtime slots: the operator's current selection carries into the new
    // conversation. Only the recorded parameters are dropped, because nothing is cached yet.
    this.#recorded = null;
  }

  public record(conversationId: string): void {
    const current: CacheParameters = { model: this.model, thinking: this.thinking, effort: this.effort };
    this.#recorded = current;
    this.objects.set(MODEL_SETTINGS_COLLECTION, conversationId, JSON.stringify(current));
  }

  #syncStatus(): void {
    const override = this.model;
    this.statusState.setModel(override ?? this.configLoader.config.model, override != null);
    this.statusState.setThinkingOverride(this.thinking);
    this.statusState.setEffortOverride(this.effort);
  }
}
