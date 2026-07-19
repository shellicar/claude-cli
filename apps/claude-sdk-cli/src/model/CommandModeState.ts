import EventEmitter from 'node:events';
import type { KeyAction } from '@shellicar/claude-core/input';
import type { ImageMediaType } from '../clipboard.js';
import type { Attachment } from './AttachmentStore.js';
import { AttachmentStore } from './AttachmentStore.js';
import { EditorState } from './EditorState.js';

export type { Attachment, FileAttachment, ImageAttachment, TextAttachment } from './AttachmentStore.js';

type CommandModeStateEvents = {
  change: [];
};

/**
 * Pure state for the command mode UI: the active/inactive flag, attachment preview
 * toggle, and the underlying attachment store.
 *
 * No async I/O, no rendering. The clipboard reads and file-stat calls that happen
 * when the user presses t or f stay in AppLayout — they are I/O, not state.
 */
export type CommandContext = 'root' | 'model' | 'modelEdit' | 'cd' | 'cdEdit';

export class CommandModeState {
  #commandMode = false;
  #previewMode = false;
  #context: CommandContext = 'root';
  #cdEditor: EditorState | null = null;
  #cdError: string | null = null;
  #modelEditor: EditorState | null = null;
  #knownModels: ReadonlySet<string> = new Set();
  #attachments = new AttachmentStore();
  readonly #emitter = new EventEmitter<CommandModeStateEvents>();

  public on<K extends keyof CommandModeStateEvents>(event: K, listener: (...args: CommandModeStateEvents[K]) => void): void {
    this.#emitter.on(event, listener);
  }

  public off<K extends keyof CommandModeStateEvents>(event: K, listener: (...args: CommandModeStateEvents[K]) => void): void {
    this.#emitter.off(event, listener);
  }

  public get commandMode(): boolean {
    return this.#commandMode;
  }

  public get previewMode(): boolean {
    return this.#previewMode;
  }

  public get context(): CommandContext {
    return this.#context;
  }

  /** The pre-filled path editor, present only while the cd editor is open. */
  public get cdEditor(): EditorState | null {
    return this.#cdEditor;
  }

  /** The last failed-move message, shown under the editor until the next edit. */
  public get cdError(): string | null {
    return this.#cdError;
  }

  /** The pre-filled model-name editor, present only while the model editor is open. */
  public get modelEditor(): EditorState | null {
    return this.#modelEditor;
  }

  /** The sendable model ids known to the account (from the catalogue). Advisory:
   * used only to blue-highlight a typed id that matches. Empty until loaded. */
  public get knownModels(): ReadonlySet<string> {
    return this.#knownModels;
  }

  /** Replace the known-model id set; drives the blue match. Emits change so an
   * open editor re-renders once the catalogue lands. */
  public setKnownModels(ids: ReadonlySet<string>): void {
    this.#knownModels = ids;
    this.#emitter.emit('change');
  }

  /** Open the model-name editor pre-filled with the effective model (model → modelEdit). */
  public openModelEditor(current: string): void {
    this.#context = 'modelEdit';
    this.#modelEditor = new EditorState({ lines: [current], cursorLine: 0, cursorCol: current.length });
    this.#emitter.emit('change');
  }

  /** Close the model-name editor and return to the model sub-mode (modelEdit → model). */
  public closeModelEditor(): void {
    this.#context = 'model';
    this.#modelEditor = null;
    this.#emitter.emit('change');
  }

  /** Forward an editing key to the open model editor. */
  public handleModelEditorKey(key: KeyAction): boolean {
    if (this.#modelEditor == null) {
      return false;
    }
    const consumed = this.#modelEditor.handleKey(key);
    if (consumed) {
      this.#emitter.emit('change');
    }
    return consumed;
  }

  public get hasAttachments(): boolean {
    return this.#attachments.hasAttachments;
  }

  public get attachments(): readonly Attachment[] {
    return this.#attachments.attachments;
  }

  public get selectedIndex(): number {
    return this.#attachments.selectedIndex;
  }

  /** Enter the model-settings sub-mode. */
  public enterModelSubMode(): void {
    this.#context = 'model';
    this.#emitter.emit('change');
  }

  /** Pop one level: model → root. No-op if already at root. */
  public exitModelSubMode(): void {
    this.#context = 'root';
    this.#emitter.emit('change');
  }

  /** Enter the cd sub-menu (root → cd). */
  public enterCdSubMode(): void {
    this.#context = 'cd';
    this.#cdEditor = null;
    this.#cdError = null;
    this.#emitter.emit('change');
  }

  /** Pop the cd sub-menu (cd → root). */
  public exitCdSubMode(): void {
    this.#context = 'root';
    this.#emitter.emit('change');
  }

  /** Open the path editor pre-filled with the current directory (cd → cdEdit). */
  public openCdEditor(cwd: string): void {
    this.#context = 'cdEdit';
    this.#cdEditor = new EditorState({ lines: [cwd], cursorLine: 0, cursorCol: cwd.length });
    this.#cdError = null;
    this.#emitter.emit('change');
  }

  /** Close the path editor and return to the cd sub-menu (cdEdit → cd). */
  public closeCdEditor(): void {
    this.#context = 'cd';
    this.#cdEditor = null;
    this.#cdError = null;
    this.#emitter.emit('change');
  }

  /** Show a failed-move message; the editor stays open. */
  public setCdError(message: string): void {
    this.#cdError = message;
    this.#emitter.emit('change');
  }

  /** Forward an editing key to the open path editor, clearing any error on edit. */
  public handleCdEditorKey(key: KeyAction): boolean {
    if (this.#cdEditor == null) {
      return false;
    }
    const consumed = this.#cdEditor.handleKey(key);
    if (consumed) {
      this.#cdError = null;
      this.#emitter.emit('change');
    }
    return consumed;
  }

  /** Enter or exit command mode. Available in any turn phase. */
  public toggleCommandMode(): void {
    this.#commandMode = !this.#commandMode;
    if (!this.#commandMode) {
      this.#resetContext();
    }
    this.#emitter.emit('change');
  }

  /** Exit command mode and collapse any preview. */
  public exitCommandMode(): void {
    this.#commandMode = false;
    this.#previewMode = false;
    this.#resetContext();
    this.#emitter.emit('change');
  }

  #resetContext(): void {
    this.#context = 'root';
    this.#cdEditor = null;
    this.#cdError = null;
    this.#modelEditor = null;
  }

  /** Toggle attachment preview for the selected item. No-op if nothing is selected. */
  public togglePreview(): void {
    if (this.#attachments.selectedIndex >= 0) {
      this.#previewMode = !this.#previewMode;
    }
    this.#emitter.emit('change');
  }

  public addText(text: string): 'added' | 'duplicate' {
    const result = this.#attachments.addText(text);
    this.#emitter.emit('change');
    return result;
  }

  public addFile(path: string, fileType: 'file' | 'dir' | 'missing', sizeBytes?: number): 'added' | 'duplicate' {
    const result = this.#attachments.addFile(path, fileType, sizeBytes);
    this.#emitter.emit('change');
    return result;
  }

  public addImage(data: Buffer, mediaType: ImageMediaType): 'added' | 'duplicate' {
    const result = this.#attachments.addImage(data, mediaType);
    this.#emitter.emit('change');
    return result;
  }

  public removeSelected(): void {
    this.#attachments.removeSelected();
    this.#emitter.emit('change');
  }

  public selectLeft(): void {
    this.#attachments.selectLeft();
    this.#emitter.emit('change');
  }

  public selectRight(): void {
    this.#attachments.selectRight();
    this.#emitter.emit('change');
  }

  /** Returns all attachments and clears the store. Returns null if empty. */
  public takeAttachments(): ReturnType<AttachmentStore['takeAttachments']> {
    const result = this.#attachments.takeAttachments();
    this.#emitter.emit('change');
    return result;
  }
}
