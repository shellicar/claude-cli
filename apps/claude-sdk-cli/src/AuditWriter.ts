import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import type { IFileSystem } from '@shellicar/claude-sdk-tools/fs';

export class AuditWriter {
  readonly #fs: IFileSystem;
  readonly #auditDir: string;

  public constructor(fs: IFileSystem, auditDir: string) {
    this.#fs = fs;
    this.#auditDir = auditDir;
  }

  public write(id: string, msg: BetaMessage): void {
    const path = `${this.#auditDir}/${id}.jsonl`;
    const entry = { timestamp: new Date().toISOString(), ...msg };
    const line = `${JSON.stringify(entry)}\n`;
    this.#fs.appendFile(path, line).catch((err) => {
      // biome-ignore lint/suspicious/noConsole: fatal audit write failure
      console.error('Fatal: audit write failed', err);
      process.exit(1);
    });
  }
}
