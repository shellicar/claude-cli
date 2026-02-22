import { EventEmitter } from 'node:events';

export type AppPhase = 'idle' | 'sending' | 'thinking' | 'prompting' | 'asking';

export interface AppStateEvents {
  changed: [phase: AppPhase];
}

export class AppState extends EventEmitter<AppStateEvents> {
  private _phase: AppPhase = 'idle';
  private _promptLabel: string | null = null;
  private _promptRemaining: number | null = null;
  private _sendStartTime: number | null = null;
  private _timer: ReturnType<typeof setInterval> | undefined;

  public get phase(): AppPhase {
    return this._phase;
  }

  public get promptLabel(): string | null {
    return this._promptLabel;
  }

  public get promptRemaining(): number | null {
    return this._promptRemaining;
  }

  public get sendStartTime(): number | null {
    return this._sendStartTime;
  }

  /** User hit Ctrl+Enter — query is being sent, waiting for first SDK response */
  public sending(): void {
    this.stopTimer();
    this._sendStartTime = Date.now();
    this._promptLabel = null;
    this._promptRemaining = null;
    this.setPhase('sending');
    this._timer = setInterval(() => {
      // Re-emit so terminal can update the elapsed time display
      this.emit('changed', this._phase);
    }, 500);
  }

  /** First SDK message arrived — the model is now thinking/executing */
  public thinking(): void {
    this.stopTimer();
    this._sendStartTime = Date.now();
    this._promptLabel = null;
    this._promptRemaining = null;
    this.setPhase('thinking');
    this._timer = setInterval(() => {
      this.emit('changed', this._phase);
    }, 500);
  }

  /** A permission prompt is active (label updated externally by permission timer) */
  public prompting(label: string, remaining?: number): void {
    this.stopTimer();
    this._promptLabel = label;
    this._promptRemaining = remaining ?? null;
    this.setPhase('prompting');
  }

  /** A question prompt is active (has its own elapsed timer) */
  public asking(label: string): void {
    this.stopTimer();
    this._sendStartTime = Date.now();
    this._promptLabel = label;
    this.setPhase('asking');
    this._timer = setInterval(() => {
      this.emit('changed', this._phase);
    }, 500);
  }

  /** Query is done, back to idle */
  public idle(): void {
    this.stopTimer();
    this._promptLabel = null;
    this._promptRemaining = null;
    this._sendStartTime = null;
    this.setPhase('idle');
  }

  /** Elapsed seconds since send started, or null if not sending */
  public get elapsedSeconds(): number | null {
    if (this._sendStartTime === null) {
      return null;
    }
    return Math.floor((Date.now() - this._sendStartTime) / 1000);
  }

  private setPhase(phase: AppPhase): void {
    this._phase = phase;
    this.emit('changed', phase);
  }

  private stopTimer(): void {
    if (this._timer !== undefined) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  }
}
