import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { calculateCostSplit, reconstructCacheSplit } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';

export class AuditWriter {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;

  get #auditDir(): string {
    return `${this.fs.homedir()}/.claude/audit`;
  }

  public write(id: string, request: BetaMessageParam | undefined, msg: BetaMessage): void {
    const path = `${this.#auditDir}/${id}.jsonl`;
    const timestamp = new Date().toISOString();
    // Store the derived cost and the reconstructed per-duration breakdown so
    // re-derivation reads them back rather than recomputing. (Unchanged.)
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
    const assistant = { timestamp, costUsd, cacheCreation: { fiveMinute, oneHour }, ...msg };
    // The user delta and the assistant response are the alternating pair for this
    // API call; both take the commit timestamp (the turn is stamped as a unit).
    // One appendFile so the pair lands together. `request` is always present in a
    // live run (the tip is a user message); the undefined branch preserves the old
    // assistant-only write for any caller that has no delta.
    const userLine = request != null ? `${JSON.stringify({ role: 'user', timestamp, content: request.content })}\n` : '';
    const line = `${userLine}${JSON.stringify(assistant)}\n`;
    this.fs.appendFile(path, line).catch((err) => {
      // biome-ignore lint/suspicious/noConsole: fatal audit write failure
      console.error('Fatal: audit write failed', err);
      process.exit(1);
    });
  }
}
