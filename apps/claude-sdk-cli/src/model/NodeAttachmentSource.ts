import { stat } from 'node:fs/promises';
import { type ClipboardImageResult, readClipboardImage, readClipboardPath, readClipboardText } from '../clipboard.js';
import { AttachmentSource, type StatResult } from './AttachmentSource.js';

/** Production AttachmentSource: the real clipboard helpers and node:fs stat. */
export class NodeAttachmentSource extends AttachmentSource {
  public readText(): Promise<string | null> {
    return readClipboardText();
  }

  public readPath(): Promise<string | null> {
    return readClipboardPath();
  }

  public readImage(): Promise<ClipboardImageResult> {
    return readClipboardImage();
  }

  public async stat(path: string): Promise<StatResult | null> {
    try {
      const info = await stat(path);
      return { isDirectory: info.isDirectory(), size: info.size };
    } catch {
      return null;
    }
  }
}
