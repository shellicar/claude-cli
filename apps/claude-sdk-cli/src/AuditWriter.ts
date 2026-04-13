import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import type { IFileSystem } from '@shellicar/claude-sdk-tools/fs';

export class AuditWriter {
  readonly #fs: IFileSystem;
  readonly #auditDir: string;

  public constructor(fs: IFileSystem, auditDir: string) {
    this.#fs = fs;
    this.#auditDir = auditDir;
  }

  public write(_id: string, _msg: BetaMessage): void {}
}
