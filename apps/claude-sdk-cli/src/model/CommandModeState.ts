import type { ImageMediaType } from '../clipboard.js';
import type { Attachment } from './AttachmentStore.js';
import { AttachmentStore } from './AttachmentStore.js';

export type { Attachment, FileAttachment, ImageAttachment, TextAttachment } from './AttachmentStore.js';

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
  }

  /** Exit command mode and collapse any preview. */
  public exitCommandMode(): void {
    this.#commandMode = false;
    this.#previewMode = false;
  }

  /** Reset all command mode state — used when streaming completes. */
  public reset(): void {
    this.exitCommandMode();
    this.#attachments.clear();
  }

  /** Toggle attachment preview for the selected item. No-op if nothing is selected. */
  public togglePreview(): void {
    if (this.#attachments.selectedIndex >= 0) {
      this.#previewMode = !this.#previewMode;
    }
  }

  public addText(text: string): 'added' | 'duplicate' {
    return this.#attachments.addText(text);
  }

  public addFile(path: string, fileType: 'file' | 'dir' | 'missing', sizeBytes?: number): 'added' | 'duplicate' {
    return this.#attachments.addFile(path, fileType, sizeBytes);
  }

  public addImage(data: Buffer, mediaType: ImageMediaType): 'added' | 'duplicate' {
    return this.#attachments.addImage(data, mediaType);
  }

  public removeSelected(): void {
    this.#attachments.removeSelected();
  }

  public selectLeft(): void {
    this.#attachments.selectLeft();
  }

  public selectRight(): void {
    this.#attachments.selectRight();
  }

  /** Returns all attachments and clears the store. Returns null if empty. */
  public takeAttachments(): ReturnType<AttachmentStore['takeAttachments']> {
    return this.#attachments.takeAttachments();
  }
}
