import type { SdkMessageUsage } from '@shellicar/claude-sdk';

/**
 * Accumulates token usage across all turns in a session.
 * Pure state: no rendering, no I/O.
 */
export class StatusState {
  #totalInputTokens = 0;
  #totalCacheCreationTokens = 0;
  #totalCacheReadTokens = 0;
  #totalOutputTokens = 0;
  #totalCostUsd = 0;
  #lastContextUsed = 0;
  #contextWindow = 0;
  #model = '';

  public get totalInputTokens(): number {
    return this.#totalInputTokens;
  }
  public get totalCacheCreationTokens(): number {
    return this.#totalCacheCreationTokens;
  }
  public get totalCacheReadTokens(): number {
    return this.#totalCacheReadTokens;
  }
  public get totalOutputTokens(): number {
    return this.#totalOutputTokens;
  }
  public get totalCostUsd(): number {
    return this.#totalCostUsd;
  }
  public get lastContextUsed(): number {
    return this.#lastContextUsed;
  }
  public get contextWindow(): number {
    return this.#contextWindow;
  }
  public get model(): string {
    return this.#model;
  }

  public setModel(name: string): void {
    this.#model = name;
  }

  public update(msg: SdkMessageUsage): void {
    this.#totalInputTokens += msg.inputTokens;
    this.#totalCacheCreationTokens += (msg.cacheCreation?.ephemeral1hTokens ?? 0) + (msg.cacheCreation?.ephemeral5mTokens ?? 0);
    this.#totalCacheReadTokens += msg.cacheReadTokens;
    this.#totalOutputTokens += msg.outputTokens;
    this.#totalCostUsd += msg.costUsd;
    this.#lastContextUsed = msg.inputTokens + (msg.cacheCreation?.ephemeral1hTokens ?? 0) + (msg.cacheCreation?.ephemeral5mTokens ?? 0) + msg.cacheReadTokens;
    this.#contextWindow = msg.contextWindow;
  }
}
