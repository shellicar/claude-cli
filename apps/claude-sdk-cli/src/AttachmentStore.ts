import { createHash } from 'node:crypto';

export interface AttachedText {
  readonly kind: 'text';
  readonly hash: string;
  readonly text: string;
  readonly sizeBytes: number;
  /** Short label shown in the chip, e.g. 'txt' or 'AppLayout.ts' */
  readonly label: string;
  /** Source file path (relative to cwd) when attachment came from a file, used as <document path="..."> attribute. */
  readonly sourcePath?: string;
}

export type Attachment = AttachedText;

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

  /** Add text content. Returns 'duplicate' if already present (by content hash). */
  public addText(text: string, opts?: { label?: string; sourcePath?: string }): 'added' | 'duplicate' {
    const hash = createHash('sha256').update(text).digest('hex');
    if (this.#attachments.some((a) => a.hash === hash)) {
      return 'duplicate';
    }
    const sizeBytes = Buffer.byteLength(text);
    this.#attachments.push({ kind: 'text', hash, text, sizeBytes, label: opts?.label ?? 'txt', sourcePath: opts?.sourcePath });
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
