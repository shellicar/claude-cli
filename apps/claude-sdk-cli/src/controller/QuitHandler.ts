import type { KeyAction } from '@shellicar/claude-core/input';
import type { InputHandler } from './InputHandler.js';

/**
 * Claims ctrl+c and nothing else. ctrl+c means the same thing in every
 * composition (quit), so per decision 5 it is the only key a handler shared
 * across all chains may claim. `onExit` is the terminal teardown
 * (TerminalRenderer.exit), injected so this handler does not reference the
 * renderer.
 */
export class QuitHandler implements InputHandler {
  readonly #onExit: () => void;

  public constructor(onExit: () => void) {
    this.#onExit = onExit;
  }

  public handleKey(key: KeyAction): boolean {
    if (key.type === 'ctrl+c') {
      this.#onExit();
      process.exit(0);
    }
    return false;
  }
}
