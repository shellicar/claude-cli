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
 *
 * It also carries whether a conversation move is in flight. That sits beside the
 * phase because the two together decide whether an action on the current
 * conversation is available, and both are read to grey the ones that are not.
 * Keeping it in a store rather than on the switcher is what lets a view read it
 * without the view model bag carrying a service.
 */
/** The state's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IPrimaryViewState {
  public abstract on<K extends keyof PrimaryViewStateEvents>(event: K, listener: (...args: PrimaryViewStateEvents[K]) => void): void;
  public abstract off<K extends keyof PrimaryViewStateEvents>(event: K, listener: (...args: PrimaryViewStateEvents[K]) => void): void;
  public abstract get phase(): TurnPhase;
  public abstract setPhase(phase: TurnPhase): void;
  /** True while the process is moving between conversations. */
  public abstract get conversationMoving(): boolean;
  public abstract setConversationMoving(moving: boolean): void;
}

export class PrimaryViewState extends IPrimaryViewState {
  #phase: TurnPhase = 'editor';
  #conversationMoving = false;
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

  public get conversationMoving(): boolean {
    return this.#conversationMoving;
  }

  public setConversationMoving(moving: boolean): void {
    if (moving === this.#conversationMoving) {
      return;
    }
    this.#conversationMoving = moving;
    this.#emitter.emit('change');
  }
}
