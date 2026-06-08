import type { KeyAction } from '@shellicar/claude-core/input';
import { buildSubmitText } from '../model/buildSubmitText.js';
import type { CommandModeState, ImageAttachment } from '../model/CommandModeState.js';
import type { EditorState } from '../model/EditorState.js';
import { EDITOR_PREFIX_VISUAL_WIDTH } from '../model/editorLayout.js';
import type { TerminalState } from '../model/TerminalState.js';
import type { UserInput } from '../runAgent.js';
import type { InputHandler } from './InputHandler.js';

/**
 * Editor keys: visual up/down navigation, text editing (delegated to
 * EditorState), and ctrl+enter submit. Present only in the primary's editor
 * chain; command mode (when open) is claimed by the preceding CommandKeyHandler.
 *
 * waitForInput resets the editor and returns a promise resolved on ctrl+enter.
 * ctrl+enter is an editor key; producing the submission draws the pending
 * attachments from command-mode state (the submit unifies text and
 * attachments). That read-and-take at the submit boundary is the editor's
 * input concern, not the editor claiming command keys.
 */
export class EditorHandler implements InputHandler {
  readonly #editorState: EditorState;
  readonly #commandModeState: CommandModeState;
  readonly #terminalState: TerminalState;
  #resolve: ((value: UserInput) => void) | null = null;

  public constructor(editorState: EditorState, commandModeState: CommandModeState, terminalState: TerminalState) {
    this.#editorState = editorState;
    this.#commandModeState = commandModeState;
    this.#terminalState = terminalState;
  }

  /** Reset the editor and wait for ctrl+enter to submit. */
  public waitForInput(): Promise<UserInput> {
    this.#editorState.reset();
    return new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  public handleKey(key: KeyAction): boolean {
    if (key.type === 'up') {
      this.#editorState.moveUpVisual(this.#terminalState.cols, EDITOR_PREFIX_VISUAL_WIDTH);
      return true;
    }
    if (key.type === 'down') {
      this.#editorState.moveDownVisual(this.#terminalState.cols, EDITOR_PREFIX_VISUAL_WIDTH);
      return true;
    }
    if (this.#editorState.handleKey(key)) {
      return true;
    }
    if (key.type !== 'ctrl+enter') {
      return false;
    }
    return this.#submit();
  }

  #submit(): boolean {
    const text = this.#editorState.text.trim();
    if (!text && !this.#commandModeState.hasAttachments) {
      return true;
    }
    if (!this.#resolve) {
      return true;
    }
    const attachments = this.#commandModeState.takeAttachments();
    const images = attachments?.filter((a): a is ImageAttachment => a.kind === 'image') ?? [];
    const nonImageAttachments = attachments?.filter((a) => a.kind !== 'image') ?? [];
    const resolveInput = this.#resolve;
    this.#resolve = null;
    resolveInput({ text: buildSubmitText(text, nonImageAttachments.length > 0 ? nonImageAttachments : null), images });
    return true;
  }
}
