import type { ClipboardImageResult } from '../clipboard.js';

export type StatResult = { isDirectory: boolean; size: number };

/**
 * The I/O boundary behind command-mode attachments: clipboard reads and a
 * single filesystem stat. Abstract class to match the IProcessLauncher /
 * NodeProcessLauncher injection idiom already in model/. A fake in tests
 * returns canned values with no real I/O.
 */
export abstract class AttachmentSource {
  public abstract readText(): Promise<string | null>;
  public abstract readPath(): Promise<string | null>;
  public abstract readImage(): Promise<ClipboardImageResult>;
  /** Returns null when the path does not exist. */
  public abstract stat(path: string): Promise<StatResult | null>;
}
