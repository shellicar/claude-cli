import EventEmitter from 'node:events';

type TerminalStateEvents = {
  change: [];
};

/**
 * Terminal dimensions shared across views. TerminalRenderer pushes the size in
 * at construction and after each resize debounce; views read cols/rows here
 * instead of from a Screen.
 */
/** The state's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class ITerminalState {
  public abstract on<K extends keyof TerminalStateEvents>(event: K, listener: (...args: TerminalStateEvents[K]) => void): void;
  public abstract off<K extends keyof TerminalStateEvents>(event: K, listener: (...args: TerminalStateEvents[K]) => void): void;
  public abstract get cols(): number;
  public abstract get rows(): number;
  public abstract setSize(cols: number, rows: number): void;
}

export class TerminalState extends ITerminalState {
  #cols = 80;
  #rows = 24;
  readonly #emitter = new EventEmitter<TerminalStateEvents>();

  public on<K extends keyof TerminalStateEvents>(event: K, listener: (...args: TerminalStateEvents[K]) => void): void {
    this.#emitter.on(event, listener);
  }

  public off<K extends keyof TerminalStateEvents>(event: K, listener: (...args: TerminalStateEvents[K]) => void): void {
    this.#emitter.off(event, listener);
  }

  public get cols(): number {
    return this.#cols;
  }

  public get rows(): number {
    return this.#rows;
  }

  public setSize(cols: number, rows: number): void {
    if (cols === this.#cols && rows === this.#rows) {
      return;
    }
    this.#cols = cols;
    this.#rows = rows;
    this.#emitter.emit('change');
  }
}
