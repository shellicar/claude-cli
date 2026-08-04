import type { ThinkingEffort } from '@shellicar/claude-sdk';
import { type CacheParameters, ModelSettings } from '../src/model/ModelSettings.js';

/**
 * In-memory `ModelSettings` for tests that only need the command-mode capability. Counts the cycle
 * calls and keeps every model set, so a spec asserts on what the executor asked for rather than on
 * how the real overrides resolve precedence.
 */
export class FakeModelSettings extends ModelSettings {
  public readonly cycleCalls = { thinking: 0, effort: 0 };
  public readonly modelCalls: { model: (string | null)[] } = { model: [] };
  #cached: CacheParameters | null = null;
  #model: string | null = null;
  #thinking: 'on' | 'off' | null = null;
  #effort: ThinkingEffort | null = null;

  public cycleThinking(): void {
    this.cycleCalls.thinking += 1;
  }

  public cycleEffort(): void {
    this.cycleCalls.effort += 1;
  }

  public setModel(id: string | null): void {
    this.#model = id;
    this.modelCalls.model.push(id);
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

  public get cached(): CacheParameters | null {
    return this.#cached;
  }

  public markSent(params: CacheParameters): void {
    this.#cached = params;
  }

  public adopt(cached: CacheParameters | null): void {
    this.#cached = cached;
  }

  public carryOver(): void {
    this.#cached = null;
  }
}
