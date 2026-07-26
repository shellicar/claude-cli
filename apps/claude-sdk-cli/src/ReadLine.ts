import { type KeyAction, setupKeypressHandler } from '@shellicar/claude-core/input';

/**
 * Raw keypress source. Forwards every translated KeyAction to the consumer callback. Owns no dispatch —
 * TerminalInput routes.
 *
 * Raw mode is set by `enable()`, not the constructor: an eagerly-constructed singleton (see
 * `eagerSingletons` in `container.ts`) must not toggle stdin the moment it's built — only when the
 * composition root actually starts the interactive loop.
 */
export class ReadLine implements Disposable {
  readonly #cleanup: () => void;

  public constructor(onKey: (key: KeyAction) => void, escFastPathEnabled?: () => boolean) {
    this.#cleanup = setupKeypressHandler(onKey, escFastPathEnabled);
  }

  public enable(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
  }

  public [Symbol.dispose](): void {
    this.#cleanup();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }
}
