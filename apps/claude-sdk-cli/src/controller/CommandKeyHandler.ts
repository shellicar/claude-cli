import type { KeyAction } from '@shellicar/claude-core/input';
import type { CommandModeState } from '../model/CommandModeState.js';
import type { CommandIntent, CommandIntentExecutor } from './CommandIntentExecutor.js';
import type { InputHandler } from './InputHandler.js';

/** Key → intent bindings for the primary command set (constructed in main.ts). */
export const PRIMARY_COMMAND_BINDINGS: ReadonlyMap<string, CommandIntent> = new Map([
  ['t', 'pasteText'],
  ['f', 'pasteFile'],
  ['i', 'pasteImage'],
  ['d', 'removeAttachment'],
  ['p', 'togglePreview'],
  ['n', 'newSession'],
]);

/**
 * Owns the command-mode concern. ctrl+/ toggles command mode (claimed whenever
 * this handler is in the chain). While command mode is open, escape closes it
 * and every other key is claimed: recognised keys fire an intent, the rest are
 * swallowed. While command mode is closed, only ctrl+/ is claimed; everything
 * else passes down.
 *
 * `bindings` (key → intent) is injected so the same handler shape can drive a
 * different command set in a different presentation (decision 4, specialisable).
 */
export class CommandKeyHandler implements InputHandler {
  readonly #commandModeState: CommandModeState;
  readonly #bindings: ReadonlyMap<string, CommandIntent>;
  readonly #executor: CommandIntentExecutor;

  public constructor(commandModeState: CommandModeState, bindings: ReadonlyMap<string, CommandIntent>, executor: CommandIntentExecutor) {
    this.#commandModeState = commandModeState;
    this.#bindings = bindings;
    this.#executor = executor;
  }

  public handleKey(key: KeyAction): boolean {
    if (key.type === 'ctrl+/') {
      this.#commandModeState.toggleCommandMode();
      return true;
    }
    if (!this.#commandModeState.commandMode) {
      return false;
    }
    if (key.type === 'escape') {
      this.#commandModeState.exitCommandMode();
      return true;
    }
    if (key.type === 'left') {
      void this.#executor.execute('selectPrev');
      return true;
    }
    if (key.type === 'right') {
      void this.#executor.execute('selectNext');
      return true;
    }
    if (key.type === 'char') {
      const intent = this.#bindings.get(key.value);
      if (intent) {
        void this.#executor.execute(intent);
      }
      return true;
    }
    return true;
  }
}
