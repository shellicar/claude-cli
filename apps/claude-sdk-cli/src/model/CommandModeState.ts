import EventEmitter from 'node:events';
import type { ImageMediaType } from '../clipboard.js';
import type { Attachment } from './AttachmentStore.js';
import { AttachmentStore } from './AttachmentStore.js';

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
export class CommandModeState {
  #commandMode = false;
  #previewMode = false;
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

  public get hasAttachments(): boolean {
    return this.#attachments.hasAttachments;
  }

  public get attachments(): readonly Attachment[] {
    return this.#attachments.attachments;
  }

  public get selectedIndex(): number {
    return this.#attachments.selectedIndex;
  }

  /** Enter or exit command mode. Only meaningful in editor mode. */
  public toggleCommandMode(): void {
    this.#commandMode = !this.#commandMode;
    this.#emitter.emit('change');
  }

  /** Exit command mode and collapse any preview. */
  public exitCommandMode(): void {
    this.#commandMode = false;
    this.#previewMode = false;
    this.#emitter.emit('change');
  }

  /** Reset all command mode state — used when streaming completes. */
  public reset(): void {
    this.exitCommandMode();
    this.#attachments.clear();
    this.#emitter.emit('change');
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
