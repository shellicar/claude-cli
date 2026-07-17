import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { IHistoryWriter } from '@shellicar/claude-core/history/interfaces';
import type { HistoryMessage } from '@shellicar/claude-core/history/types';
import { calculateCostSplit, type MessageIdentity, reconstructCacheSplit } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import { logger } from './logger.js';
import { toHistoryBlocks } from './persistence/historyBlocks.js';

/**
 * Writes a committed turn to both records: the append-only audit file and the live history index. At turn commit
 * the pair (the user delta and the assistant response) share one timestamp and, from the round's `identity`, one
 * `turnId` and `queryId`; the user carries the identity's `messageId` while the assistant keeps its API `msg.id`
 * (write-model §1/§3). A legacy round with no `identity` writes the old id-less v1 shape and is not indexed — the
 * store's ids are NOT NULL, and the migration + a later ingest bring such a file up to v2.
 */
export class AuditWriter {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(IHistoryWriter) private readonly index!: IHistoryWriter;

  get #auditDir(): string {
    return `${this.fs.homedir()}/.claude/audit`;
  }

  public write(conversationId: string, request: BetaMessageParam | undefined, msg: BetaMessage, identity?: MessageIdentity): void {
    const path = `${this.#auditDir}/${conversationId}.jsonl`;
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
    // v2 stamps the turn's `turnId`/`queryId` onto both lines; the assistant keeps its API `id` (spread from msg).
    // A legacy round (no identity) writes the id-less v1 shape unchanged.
    const turnIds = identity != null ? { turnId: identity.turnId, queryId: identity.queryId } : {};
    const assistant = { timestamp, costUsd, cacheCreation: { fiveMinute, oneHour }, ...msg, ...turnIds };
    // The user delta and the assistant response are the alternating pair for this
    // API call; both take the commit timestamp (the turn is stamped as a unit).
    // One appendFile so the pair lands together. `request` is always present in a
    // live run (the tip is a user message); the undefined branch preserves the old
    // assistant-only write for any caller that has no delta.
    const user = request != null ? (identity != null ? { role: 'user', id: identity.messageId, turnId: identity.turnId, queryId: identity.queryId, timestamp, content: request.content } : { role: 'user', timestamp, content: request.content }) : null;
    const userLine = user != null ? `${JSON.stringify(user)}\n` : '';
    const line = `${userLine}${JSON.stringify(assistant)}\n`;
    this.fs.appendFile(path, line).catch((err) => {
      // biome-ignore lint/suspicious/noConsole: fatal audit write failure
      console.error('Fatal: audit write failed', err);
      process.exit(1);
    });

    // Keep the live index current: project the same pair through the write seam, each stamped with the
    // conversationId (the session). Only a v2 round can be indexed; the ingest heals any turn missed here.
    // The projection is best-effort (write-model §1): the index is a rebuildable projection, so a failure is
    // logged and swallowed here, never propagated. The audit append above is the primary, source-of-truth
    // write; ingest heals any gap from it. The history record must never break the conversation it records.
    if (identity != null) {
      try {
        if (request != null) {
          this.index.insert(this.#message(identity.messageId, conversationId, identity, timestamp, 'user', request.content));
        }
        this.index.insert(this.#message(msg.id, conversationId, identity, timestamp, 'assistant', msg.content));
      } catch (err) {
        logger.error('History index projection failed; the audit holds the turn and ingest will heal it', err);
      }
    }
  }

  #message(id: string, conversationId: string, identity: MessageIdentity, timestamp: string, role: HistoryMessage['role'], content: Parameters<typeof toHistoryBlocks>[0]): HistoryMessage {
    return { id, conversationId, turnId: identity.turnId, queryId: identity.queryId, timestamp, role, blocks: toHistoryBlocks(content) };
  }
}
