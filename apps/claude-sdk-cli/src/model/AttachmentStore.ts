import { createHash } from 'node:crypto';
import type { ImageMediaType } from '../clipboard.js';

export type TextAttachment = {
  readonly kind: 'text';
  readonly hash: string;
  readonly text: string;
  readonly sizeBytes: number; // stored bytes (≤ 10 KB cap)
  readonly fullSizeBytes: number; // original byte length before any cap
  readonly truncated: boolean;
};

export type FileAttachment = {
  readonly kind: 'file';
  readonly path: string;
  readonly fileType: 'file' | 'dir' | 'missing';
  readonly sizeBytes?: number; // only when fileType === 'file'
};

export type ImageAttachment = {
  readonly kind: 'image';
  readonly hash: string;
  readonly base64: string;
  readonly mediaType: ImageMediaType;
  readonly sizeBytes: number;
};

export type Attachment = TextAttachment | FileAttachment | ImageAttachment;

export class AttachmentStore {
  readonly #attachments: Attachment[] = [];
  #selectedIndex = -1;

  public get attachments(): readonly Attachment[] {
    return this.#attachments;
  }

  public get selectedIndex(): number {
    return this.#selectedIndex;
  }

  public get hasAttachments(): boolean {
    return this.#attachments.length > 0;
  }

  /** Add plain-text content. Returns 'duplicate' if already present (by SHA-256). */
  public addText(text: string): 'added' | 'duplicate' {
    const hash = createHash('sha256').update(text).digest('hex');
    if (this.#attachments.some((a) => a.kind === 'text' && a.hash === hash)) {
      return 'duplicate';
    }
    const TEXT_CAP = 10 * 1024; // 10 KB
    const fullBytes = Buffer.from(text, 'utf8');
    const fullSizeBytes = fullBytes.length;
    const truncated = fullSizeBytes > TEXT_CAP;
    // Slice at a UTF-8 byte boundary to avoid splitting a multi-byte character
    const storedText = truncated ? fullBytes.subarray(0, TEXT_CAP).toString('utf8') : text;
    const sizeBytes = truncated ? Buffer.byteLength(storedText, 'utf8') : fullSizeBytes;
    this.#attachments.push({ kind: 'text', hash, text: storedText, sizeBytes, fullSizeBytes, truncated });
    this.#selectedIndex = this.#attachments.length - 1;
    return 'added';
  }

  /** Add an image attachment. Returns 'duplicate' if already present (by SHA-256 of raw bytes). */
  public addImage(data: Buffer, mediaType: ImageMediaType): 'added' | 'duplicate' {
    throw new Error('not implemented');
  }

  /** Add a file/dir/missing path reference. Returns 'duplicate' if the same path is already attached. */
  public addFile(path: string, fileType: 'file' | 'dir' | 'missing', sizeBytes?: number): 'added' | 'duplicate' {
    if (this.#attachments.some((a) => a.kind === 'file' && a.path === path)) {
      return 'duplicate';
    }
    this.#attachments.push({ kind: 'file', path, fileType, sizeBytes });
    this.#selectedIndex = this.#attachments.length - 1;
    return 'added';
  }

  public removeSelected(): void {
    if (this.#selectedIndex < 0 || this.#selectedIndex >= this.#attachments.length) {
      return;
    }
    this.#attachments.splice(this.#selectedIndex, 1);
    this.#selectedIndex = this.#attachments.length === 0 ? -1 : Math.min(this.#selectedIndex, this.#attachments.length - 1);
  }

  public selectLeft(): void {
    if (this.#attachments.length === 0) {
      return;
    }
    this.#selectedIndex = Math.max(0, this.#selectedIndex - 1);
  }

  public selectRight(): void {
    if (this.#attachments.length === 0) {
      return;
    }
    this.#selectedIndex = Math.min(this.#attachments.length - 1, this.#selectedIndex + 1);
  }

  public clear(): void {
    this.#attachments.length = 0;
    this.#selectedIndex = -1;
  }

  /** Returns all attachments and clears the store. Returns null if empty. */
  public takeAttachments(): readonly Attachment[] | null {
    if (this.#attachments.length === 0) {
      return null;
    }
    const copy = [...this.#attachments];
    this.clear();
    return copy;
  }
}
