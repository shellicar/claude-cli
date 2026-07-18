import type { KeyAction } from '@shellicar/claude-core/input';
import type { InputHandler } from './InputHandler.js';

/**
 * Claims ctrl+c and nothing else. ctrl+c means the same thing in every
 * composition (quit), so per decision 5 it is the only key a handler shared
 * across all chains may claim. `onQuit` requests the shutdown coordinator
 * (see ShutdownCoordinator) rather than exiting directly: exiting here would
 * bypass `cleanup` — the only place that detaches from the agent concern —
 * so a keypress quit must join the same sequence SIGINT and SIGTERM use, not
 * race around it. Passed as a closure by the composition root: a controller
 * may not import the setup layer, so the coordinator is wired in via the
 * container factory rather than injected as a field.
 */
export class QuitHandler implements InputHandler {
  readonly #onQuit: () => void;

  public constructor(onQuit: () => void) {
    this.#onQuit = onQuit;
  }

  public handleKey(key: KeyAction): boolean {
    if (key.type === 'ctrl+c') {
      this.#onQuit();
    }
    return false;
  }
}
