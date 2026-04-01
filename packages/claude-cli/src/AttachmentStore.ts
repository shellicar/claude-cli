import { createHash } from 'node:crypto';

export interface AttachedImage {
  readonly kind: 'image';
  readonly hash: string;
  readonly base64: string;
  readonly sizeBytes: number;
}

export interface AttachedText {
  readonly kind: 'text';
  readonly hash: string;
  readonly text: string;
  readonly sizeBytes: number;
}

export type Attachment = AttachedImage | AttachedText;

export class AttachmentStore {
  private readonly _attachments: Attachment[] = [];
  private _selectedIndex = -1;

  public get attachments(): readonly Attachment[] {
    return this._attachments;
  }

  public get selectedIndex(): number {
    return this._selectedIndex;
  }

  public get hasAttachments(): boolean {
    return this._attachments.length > 0;
  }

  public addImage(data: Buffer): boolean {
    const hash = createHash('sha256').update(data).digest('hex');
    if (this._attachments.some((a) => a.hash === hash)) {
      return true;
    }
    const base64 = data.toString('base64');
    this._attachments.push({ kind: 'image', hash, base64, sizeBytes: data.length });
    this._selectedIndex = this._attachments.length - 1;
    return false;
  }

  public addText(text: string): boolean {
    const hash = createHash('sha256').update(text).digest('hex');
    if (this._attachments.some((a) => a.hash === hash)) {
      return true;
    }
    const sizeBytes = Buffer.byteLength(text);
    this._attachments.push({ kind: 'text', hash, text, sizeBytes });
    this._selectedIndex = this._attachments.length - 1;
    return false;
  }

  public removeSelected(): void {
    if (this._selectedIndex < 0 || this._selectedIndex >= this._attachments.length) {
      return;
    }
    this._attachments.splice(this._selectedIndex, 1);
    this._selectedIndex = this._attachments.length === 0 ? -1 : Math.min(this._selectedIndex, this._attachments.length - 1);
  }

  public selectLeft(): void {
    if (this._attachments.length === 0) {
      return;
    }
    this._selectedIndex = Math.max(0, this._selectedIndex - 1);
  }

  public selectRight(): void {
    if (this._attachments.length === 0) {
      return;
    }
    this._selectedIndex = Math.min(this._attachments.length - 1, this._selectedIndex + 1);
  }

  public clear(): void {
    this._attachments.length = 0;
    this._selectedIndex = -1;
  }

  public takeAttachments(): readonly Attachment[] | undefined {
    if (this._attachments.length === 0) {
      return undefined;
    }
    const copy = [...this._attachments];
    this.clear();
    return copy;
  }
}
