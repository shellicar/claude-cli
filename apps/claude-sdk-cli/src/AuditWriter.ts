import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { calculateCostSplit, reconstructCacheSplit } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';

export class AuditWriter {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;

  get #auditDir(): string {
    return `${this.fs.homedir()}/.claude/audit`;
  }

  public write(id: string, msg: BetaMessage): void {
    const path = `${this.#auditDir}/${id}.jsonl`;
    // Store the derived cost and the reconstructed per-duration breakdown so
    // re-derivation reads them back rather than recomputing. There is no stored
    // cacheTtl — the breakdown is the truth, and cost is priced straight from it.
    const { fiveMinute, oneHour } = reconstructCacheSplit(msg.usage);
    const costUsd = calculateCostSplit(
      {
        inputTokens: msg.usage.input_tokens,
        cacheCreation5mTokens: fiveMinute,
        cacheCreation1hTokens: oneHour,
        cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
        outputTokens: msg.usage.output_tokens,
      },
      msg.model,
    );
    const entry = { timestamp: new Date().toISOString(), costUsd, cacheCreation: { fiveMinute, oneHour }, ...msg };
    const line = `${JSON.stringify(entry)}\n`;
    this.fs.appendFile(path, line).catch((err) => {
      // biome-ignore lint/suspicious/noConsole: fatal audit write failure
      console.error('Fatal: audit write failed', err);
      process.exit(1);
    });
  }
}
