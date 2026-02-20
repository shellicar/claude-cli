import { EventEmitter } from 'node:events';

export type AppPhase = 'idle' | 'sending' | 'thinking' | 'prompting';

export interface AppStateEvents {
  changed: [phase: AppPhase];
}

export class AppState extends EventEmitter<AppStateEvents> {
  private _phase: AppPhase = 'idle';
  private _promptLabel: string | null = null;
  private _sendStartTime: number | null = null;
  private _timer: ReturnType<typeof setInterval> | undefined;

  public get phase(): AppPhase {
    return this._phase;
  }

  public get promptLabel(): string | null {
    return this._promptLabel;
  }

  public get sendStartTime(): number | null {
    return this._sendStartTime;
  }

  /** User hit Ctrl+Enter — query is being sent, waiting for first SDK response */
  public sending(): void {
    this.stopTimer();
    this._sendStartTime = Date.now();
    this._promptLabel = null;
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
    this.setPhase('thinking');
    this._timer = setInterval(() => {
      this.emit('changed', this._phase);
    }, 500);
  }

  /** A permission or question prompt is active */
  public prompting(label: string): void {
    this.stopTimer();
    this._promptLabel = label;
    this.setPhase('prompting');
  }

  /** Query is done, back to idle */
  public idle(): void {
    this.stopTimer();
    this._promptLabel = null;
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
