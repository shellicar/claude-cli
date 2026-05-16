import path from 'node:path';
import type { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
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
  #sessionName: string | null = null;
  readonly #cwdBasename: string;

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
  public get sessionName(): string | null {
    return this.#sessionName;
  }
  public get cwdBasename(): string {
    return this.#cwdBasename;
  }

  public constructor(fs: IFileSystem) {
    this.#cwdBasename = path.basename(fs.cwd());
  }

  public setModel(name: string): void {
    this.#model = name;
  }

  public setSessionName(name: string): void {
    this.#sessionName = name;
  }

  public update(msg: SdkMessageUsage): void {
    this.#totalInputTokens += msg.inputTokens;
    this.#totalCacheCreationTokens += msg.cacheCreationTokens;
    this.#totalCacheReadTokens += msg.cacheReadTokens;
    this.#totalOutputTokens += msg.outputTokens;
    this.#totalCostUsd += msg.costUsd;
    this.#lastContextUsed = msg.inputTokens + msg.cacheCreationTokens + msg.cacheReadTokens;
    this.#contextWindow = msg.contextWindow;
  }
}
