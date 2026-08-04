import type { KeyAction } from '@shellicar/claude-core/input';
import { IConversation } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { buildSubmitText } from '../model/buildSubmitText.js';
import { ICommandModeState, type ImageAttachment } from '../model/CommandModeState.js';
import { IEditorBuffer } from '../model/EditorBuffer.js';
import { editorText } from '../model/EditorContent.js';
import { EDITOR_PREFIX_VISUAL_WIDTH } from '../model/editorLayout.js';
import { ITurnClock } from '../model/ITurnClock.js';
import { ITerminalState } from '../model/TerminalState.js';
import type { UserInput } from '../runAgent.js';
import type { InputHandler } from './InputHandler.js';

/**
 * Editor keys: visual up/down navigation, text editing (delegated to
 * EditorBuffer), and ctrl+enter submit. Present only in the primary's editor
 * chain; command mode (when open) is claimed by the preceding CommandKeyHandler.
 *
 * waitForInput resets the editor and returns a promise resolved on ctrl+enter.
 * ctrl+enter is an editor key; producing the submission draws the pending
 * attachments from command-mode state (the submit unifies text and
 * attachments). That read-and-take at the submit boundary is the editor's
 * input concern, not the editor claiming command keys.
 */
export class EditorHandler implements InputHandler {
  @dependsOn(IEditorBuffer) private readonly editorBuffer!: IEditorBuffer;
  @dependsOn(ICommandModeState) private readonly commandModeState!: ICommandModeState;
  @dependsOn(ITerminalState) private readonly terminalState!: ITerminalState;
  @dependsOn(IConversation) private readonly conversation!: IConversation;
  @dependsOn(ITurnClock) private readonly turnClock!: ITurnClock;
  #resolve: ((value: UserInput) => void) | null = null;

  /**
   * Wait for ctrl+enter to submit.
   *
   * Does not clear the editor: `runAgent` already resets it as every turn ends, so a second reset
   * here only destroys content deliberately placed between the two — the prompt handed back after
   * an interrupt that rolled its query back.
   */
  public waitForInput(): Promise<UserInput> {
    this.turnClock.userStart();
    return new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  public handleKey(key: KeyAction): boolean {
    if (key.type === 'up') {
      this.editorBuffer.moveUpVisual(this.terminalState.cols, EDITOR_PREFIX_VISUAL_WIDTH);
      return true;
    }
    if (key.type === 'down') {
      this.editorBuffer.moveDownVisual(this.terminalState.cols, EDITOR_PREFIX_VISUAL_WIDTH);
      return true;
    }
    if (this.editorBuffer.handleKey(key)) {
      return true;
    }
    if (key.type !== 'ctrl+enter') {
      return false;
    }
    return this.#submit();
  }

  #submit(): boolean {
    const text = editorText(this.editorBuffer.content).trim();
    if (!text && !this.commandModeState.hasAttachments) {
      // Nothing typed: allow an empty submit ONLY to resume an interrupted turn,
      // i.e. when the conversation already ends on an unanswered user message.
      if (this.conversation.messages.at(-1)?.role !== 'user') {
        return true;
      }
      if (!this.#resolve) {
        return true;
      }
      const resolveResume = this.#resolve;
      this.#resolve = null;
      this.turnClock.userStop();
      resolveResume({ text: '', images: [], resume: true });
      return true;
    }
    if (!this.#resolve) {
      return true;
    }
    const attachments = this.commandModeState.takeAttachments();
    const images = attachments?.filter((a): a is ImageAttachment => a.kind === 'image') ?? [];
    const nonImageAttachments = attachments?.filter((a) => a.kind !== 'image') ?? [];
    const resolveInput = this.#resolve;
    this.#resolve = null;
    this.turnClock.userStop();
    resolveInput({ text: buildSubmitText(text, nonImageAttachments.length > 0 ? nonImageAttachments : null), images });
    return true;
  }
}
