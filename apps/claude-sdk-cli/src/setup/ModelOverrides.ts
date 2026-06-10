import type { ThinkingEffort } from '@shellicar/claude-sdk';
import type { ModelSettings } from '../model/ModelSettings.js';
import type { StatusState } from '../model/StatusState.js';

const THINKING_CYCLE = [null, 'on', 'off'] as const;
const EFFORT_CYCLE: (ThinkingEffort | null)[] = [null, 'max', 'xhigh', 'high', 'medium', 'low'];

export class ModelOverrides implements ModelSettings {
  #model: string | null;
  #thinking: 'on' | 'off' | null = null;
  #effort: ThinkingEffort | null = null;
  readonly #statusState: StatusState;

  public constructor(initialModel: string | null, statusState: StatusState) {
    this.#model = initialModel;
    this.#statusState = statusState;
  }

  public get model(): string | null {
    return this.#model;
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
    this.#statusState.setThinkingOverride(this.#thinking);
  }

  public cycleEffort(): void {
    const idx = EFFORT_CYCLE.indexOf(this.#effort);
    this.#effort = EFFORT_CYCLE[(idx + 1) % EFFORT_CYCLE.length] ?? null;
    this.#statusState.setEffortOverride(this.#effort);
  }
}
