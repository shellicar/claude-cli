import EventEmitter from 'node:events';
import type { SdkMessageUsage, ThinkingEffort } from '@shellicar/claude-sdk';

type StatusStateEvents = {
  change: [];
};

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
  #modelOverridden = false;
  #sessionName: string | null = null;
  #identityName: string | null = null;
  #showConversationId = false;
  #thinkingOverride: 'on' | 'off' | null = null;
  #effortOverride: ThinkingEffort | null = null;
  readonly #cwdBasename: string;
  readonly #emitter = new EventEmitter<StatusStateEvents>();

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
  public get isModelOverridden(): boolean {
    return this.#modelOverridden;
  }
  public get sessionName(): string | null {
    return this.#sessionName;
  }
  public get identityName(): string | null {
    return this.#identityName;
  }
  public get showConversationId(): boolean {
    return this.#showConversationId;
  }
  public get thinkingOverride(): 'on' | 'off' | null {
    return this.#thinkingOverride;
  }
  public get effortOverride(): ThinkingEffort | null {
    return this.#effortOverride;
  }
  public get cwdBasename(): string {
    return this.#cwdBasename;
  }

  public constructor(cwdBasename: string) {
    this.#cwdBasename = cwdBasename;
  }

  public on<K extends keyof StatusStateEvents>(event: K, listener: (...args: StatusStateEvents[K]) => void): void {
    this.#emitter.on(event, listener);
  }

  public off<K extends keyof StatusStateEvents>(event: K, listener: (...args: StatusStateEvents[K]) => void): void {
    this.#emitter.off(event, listener);
  }

  public setModel(name: string, overridden = false): void {
    this.#model = name;
    this.#modelOverridden = overridden;
    this.#emitter.emit('change');
  }

  public setSessionName(name: string): void {
    this.#sessionName = name;
    this.#emitter.emit('change');
  }

  public setIdentityName(name: string | null): void {
    this.#identityName = name;
    this.#emitter.emit('change');
  }

  public setShowConversationId(show: boolean): void {
    this.#showConversationId = show;
    this.#emitter.emit('change');
  }

  public setThinkingOverride(state: 'on' | 'off' | null): void {
    this.#thinkingOverride = state;
    this.#emitter.emit('change');
  }

  public setEffortOverride(effort: ThinkingEffort | null): void {
    this.#effortOverride = effort;
    this.#emitter.emit('change');
  }

  public update(msg: SdkMessageUsage): void {
    this.#totalInputTokens += msg.inputTokens;
    this.#totalCacheCreationTokens += msg.cacheCreationTokens;
    this.#totalCacheReadTokens += msg.cacheReadTokens;
    this.#totalOutputTokens += msg.outputTokens;
    this.#totalCostUsd += msg.costUsd;
    this.#lastContextUsed = msg.inputTokens + msg.cacheCreationTokens + msg.cacheReadTokens;
    this.#contextWindow = msg.contextWindow;
    this.#emitter.emit('change');
  }
}
