import type { KeyAction } from '@shellicar/claude-core/input';
import { dependsOn } from '@shellicar/core-di-lite';
import { type CommandContext, CommandModeState } from '../model/CommandModeState.js';
import { type CommandIntent, CommandIntentExecutor } from './CommandIntentExecutor.js';
import type { InputHandler } from './InputHandler.js';

/** Root command set: the keys available when command mode first opens. */
export const PRIMARY_COMMAND_BINDINGS: ReadonlyMap<string, CommandIntent> = new Map([
  ['t', 'pasteText'],
  ['f', 'pasteFile'],
  ['i', 'pasteImage'],
  ['d', 'removeAttachment'],
  ['p', 'togglePreview'],
  ['c', 'enterCdSubMode'],
  ['n', 'newSession'],
  ['m', 'enterModelSubMode'],
]);

/** cd sub-menu command set: d opens the path editor. One entry by design — the
 * sub-menu exists now so its shape does not have to change when more directory
 * operations join it later. */
export const CD_COMMAND_BINDINGS: ReadonlyMap<string, CommandIntent> = new Map([['d', 'openCdEditor']]);

/** Model sub-mode command set: t/e cycle the per-session thinking and effort. */
export const MODEL_COMMAND_BINDINGS: ReadonlyMap<string, CommandIntent> = new Map([
  ['t', 'cycleThinking'],
  ['e', 'cycleEffort'],
]);

/** The binding set in force for each command-mode context. */
export const COMMAND_BINDINGS_BY_CONTEXT: ReadonlyMap<CommandContext, ReadonlyMap<string, CommandIntent>> = new Map([
  ['root', PRIMARY_COMMAND_BINDINGS],
  ['model', MODEL_COMMAND_BINDINGS],
  ['cd', CD_COMMAND_BINDINGS],
]);

/**
 * Owns the command-mode concern. ctrl+/ toggles command mode (claimed whenever
 * this handler is in the chain). While command mode is open, escape pops one
 * level — out of the model sub-mode if it is open, otherwise out of command
 * mode — and every other key is claimed: a key bound in the active context
 * fires its intent, the rest are swallowed.
 *
 * The binding set is chosen per keypress from the command mode's current
 * context, so the same handler shape drives a different command set in the
 * model sub-mode (decision 4, specialisable). Attachment navigation (left/right)
 * belongs to the root context only.
 */
export class CommandKeyHandler implements InputHandler {
  @dependsOn(CommandModeState) private readonly commandModeState!: CommandModeState;
  @dependsOn(CommandIntentExecutor) private readonly executor!: CommandIntentExecutor;
  readonly #bindingsByContext = COMMAND_BINDINGS_BY_CONTEXT;

  public handleKey(key: KeyAction): boolean {
    if (key.type === 'ctrl+/') {
      this.commandModeState.toggleCommandMode();
      return true;
    }
    if (!this.commandModeState.commandMode) {
      return false;
    }
    if (this.commandModeState.context === 'cdEdit') {
      return this.#handleCdEditorKey(key);
    }
    if (key.type === 'escape') {
      if (this.commandModeState.context === 'cd') {
        this.commandModeState.exitCdSubMode();
      } else if (this.commandModeState.context === 'model') {
        this.commandModeState.exitModelSubMode();
      } else {
        this.commandModeState.exitCommandMode();
      }
      return true;
    }
    if (this.commandModeState.context === 'root') {
      if (key.type === 'left') {
        void this.executor.execute('selectPrev');
        return true;
      }
      if (key.type === 'right') {
        void this.executor.execute('selectNext');
        return true;
      }
    }
    if (key.type === 'char') {
      const intent = this.#bindingsByContext.get(this.commandModeState.context)?.get(key.value);
      if (intent) {
        void this.executor.execute(intent);
      }
      return true;
    }
    return true;
  }

  /**
   * Modal path-editor keys. Enter is the authoritative submit (attempt the
   * chdir); Escape backs out to the cd sub-menu with the cwd unchanged. Up/down
   * are swallowed — a path is a single line. Every other key is forwarded to the
   * editor buffer.
   */
  #handleCdEditorKey(key: KeyAction): boolean {
    if (key.type === 'escape') {
      this.commandModeState.closeCdEditor();
      return true;
    }
    if (key.type === 'enter') {
      void this.executor.execute('submitCd');
      return true;
    }
    if (key.type === 'up' || key.type === 'down') {
      return true;
    }
    this.commandModeState.handleCdEditorKey(key);
    return true;
  }
}
