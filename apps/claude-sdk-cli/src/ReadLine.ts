import { type KeyAction, setupKeypressHandler } from '@shellicar/claude-core/input';

/**
 * Raw keypress source. Sets stdin raw mode and forwards every translated
 * KeyAction to the consumer callback. Owns no dispatch — TerminalInput routes.
 */
export class ReadLine implements Disposable {
  readonly #cleanup: () => void;

  public constructor(onKey: (key: KeyAction) => void) {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    this.#cleanup = setupKeypressHandler(onKey);
  }

  public [Symbol.dispose](): void {
    this.#cleanup();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }
}
