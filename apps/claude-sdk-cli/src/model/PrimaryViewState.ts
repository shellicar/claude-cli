import EventEmitter from 'node:events';

/** The primary presentation's turn phase: awaiting input vs a turn in progress. */
export type TurnPhase = 'editor' | 'streaming';

type PrimaryViewStateEvents = {
  change: [];
};

/**
 * The primary presentation's own sub-state: its turn phase. 'editor' shows the
 * editor region and selects the editor chain; 'streaming' hides the editor and
 * selects the streaming chain. runAgent sets it around a turn; PrimaryView
 * reads it for the editor region; PrimaryPresentation reads it to pick the
 * active chain. Nested inside the primary, never a top-level mode.
 */
export class PrimaryViewState {
  #phase: TurnPhase = 'editor';
  readonly #emitter = new EventEmitter<PrimaryViewStateEvents>();

  public on<K extends keyof PrimaryViewStateEvents>(event: K, listener: (...args: PrimaryViewStateEvents[K]) => void): void {
    this.#emitter.on(event, listener);
  }

  public off<K extends keyof PrimaryViewStateEvents>(event: K, listener: (...args: PrimaryViewStateEvents[K]) => void): void {
    this.#emitter.off(event, listener);
  }

  public get phase(): TurnPhase {
    return this.#phase;
  }

  public setPhase(phase: TurnPhase): void {
    if (phase === this.#phase) {
      return;
    }
    this.#phase = phase;
    this.#emitter.emit('change');
  }
}
