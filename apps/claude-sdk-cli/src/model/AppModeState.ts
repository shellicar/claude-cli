import EventEmitter from 'node:events';

/** Which presentation is active. */
export type AppModeKey = 'primary' | 'history';

type AppModeStateEvents = {
  change: [];
};

/**
 * Which presentation is on screen. 'primary' today; the history view (#179)
 * adds 'history' and a key that calls setActive to switch. This is the
 * presentation axis only — it says nothing about whether a turn is running,
 * which is the primary's own phase (PrimaryViewState). A turn streams under any
 * presentation, so the two are orthogonal and live in separate stores.
 */
/** The state's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IAppModeState {
  public abstract on<K extends keyof AppModeStateEvents>(event: K, listener: (...args: AppModeStateEvents[K]) => void): void;
  public abstract off<K extends keyof AppModeStateEvents>(event: K, listener: (...args: AppModeStateEvents[K]) => void): void;
  public abstract get active(): AppModeKey;
  public abstract setActive(key: AppModeKey): void;
}

export class AppModeState extends IAppModeState {
  #active: AppModeKey = 'primary';
  readonly #emitter = new EventEmitter<AppModeStateEvents>();

  public on<K extends keyof AppModeStateEvents>(event: K, listener: (...args: AppModeStateEvents[K]) => void): void {
    this.#emitter.on(event, listener);
  }

  public off<K extends keyof AppModeStateEvents>(event: K, listener: (...args: AppModeStateEvents[K]) => void): void {
    this.#emitter.off(event, listener);
  }

  public get active(): AppModeKey {
    return this.#active;
  }

  public setActive(key: AppModeKey): void {
    if (key === this.#active) {
      return;
    }
    this.#active = key;
    this.#emitter.emit('change');
  }
}
