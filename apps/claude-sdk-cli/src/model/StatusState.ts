import EventEmitter from 'node:events';
import type { SdkMessageUsage, ThinkingEffort } from '@shellicar/claude-sdk';

type StatusStateEvents = {
  change: [];
};

/** A derived snapshot of the running totals. Produced by re-deriving the stats
 * from the audit for a conversation id; the zero snapshot reads as empty. */
export type StatusTotals = {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
  lastContextUsed: number;
  contextWindow: number;
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
  #cwdBasename: string;
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

  /** Update the working-directory label. Called when the session moves so the
   * status bar reflects the new directory (used only when no --name is set). */
  public setCwdBasename(name: string): void {
    this.#cwdBasename = name;
    this.#emitter.emit('change');
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

  /**
   * Replace the running totals wholesale from a derived snapshot. Called when
   * the figures are re-derived from the audit for the current conversation id
   * (startup and id change). An id with no audit data derives the zero snapshot,
   * which reads as empty. This is distinct from `update`, which adds one turn's
   * usage for live in-turn movement.
   */
  public resetTo(totals: StatusTotals): void {
    this.#totalInputTokens = totals.inputTokens;
    this.#totalCacheCreationTokens = totals.cacheCreationTokens;
    this.#totalCacheReadTokens = totals.cacheReadTokens;
    this.#totalOutputTokens = totals.outputTokens;
    this.#totalCostUsd = totals.costUsd;
    this.#lastContextUsed = totals.lastContextUsed;
    this.#contextWindow = totals.contextWindow;
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
