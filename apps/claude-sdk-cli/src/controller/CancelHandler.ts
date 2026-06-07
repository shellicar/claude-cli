import type { KeyAction } from '@shellicar/claude-core/input';
import type { InputHandler } from './InputHandler.js';

/**
 * Owns the cancel concern: escape aborts the running turn. `onCancel` is
 * injected (it posts a cancel on the consumer channel). This handler is in the
 * primary's streaming chain only, so escape reaches it only while a turn is
 * running. The editor chain has no CancelHandler, so editor-phase escape
 * (command mode closed) is unclaimed and posts nothing, matching today, where
 * editor-phase escape called a null cancelFn and sent nothing.
 */
export class CancelHandler implements InputHandler {
  readonly #onCancel: () => void;

  public constructor(onCancel: () => void) {
    this.#onCancel = onCancel;
  }

  public handleKey(key: KeyAction): boolean {
    if (key.type === 'escape') {
      this.#onCancel();
      return true;
    }
    return false;
  }
}
