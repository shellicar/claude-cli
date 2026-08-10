import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { IHistoryWriter } from '@shellicar/claude-core/history/interfaces';
import type { HistoryMessage } from '@shellicar/claude-core/history/types';
import { calculateCostSplit, reconstructCacheSplit } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { auditPathFor } from './conversations/auditPath.js';
import { logger } from './logger.js';
import { toHistoryBlocks } from './persistence/historyBlocks.js';

/**
 * Writes committed messages to both records: the append-only audit file and the live history index.
 * One message, one line, written when that message is committed — not when the round it belongs to
 * finishes. A query cancelled during its tools commits a tool_result message and then ends, so a
 * round-shaped write would never record it while the wire already had it; per-message writes keep the
 * two records holding the same set, which is what lets the tip be read back from the audit.
 *
 * Each line carries the message's own minted id, the same id the change publisher puts on the wire.
 * The API's `msg.id` is kept beside the assistant's as `apiMessageId` rather than overwriting it: it
 * names a service response, not an occurrence in the dialogue.
 */
export class AuditWriter {
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(IHistoryWriter) private readonly index!: IHistoryWriter;

  /** A user-role message: the operator's ask, or a round's tool_result delivery. Written where the
   *  message is committed, alongside its save and its publish. */
  public writeUser(conversationId: string, msg: BetaMessageParam, messageId: string, queryId: string, turnId: string): void {
    const timestamp = new Date().toISOString();
    this.#append(conversationId, { role: 'user', id: messageId, turnId, queryId, timestamp, content: msg.content });
    this.#project(this.#message(messageId, conversationId, queryId, turnId, timestamp, 'user', msg.content));
  }

  /** The assistant's message, written the moment the response completes. Deliberately not deferred to
   *  the publish: model output cannot be regenerated, so it is recorded before anything waits on disk. */
  public writeAssistant(conversationId: string, msg: BetaMessage, messageId: string, queryId: string, turnId: string): void {
    const timestamp = new Date().toISOString();
    // Store the derived cost and the reconstructed per-duration breakdown so
    // re-derivation reads them back rather than recomputing.
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
    this.#append(conversationId, { timestamp, costUsd, cacheCreation: { fiveMinute, oneHour }, ...msg, apiMessageId: msg.id, id: messageId, turnId, queryId });
    this.#project(this.#message(messageId, conversationId, queryId, turnId, timestamp, 'assistant', msg.content));
  }

  #append(conversationId: string, line: object): void {
    this.fs.appendFile(auditPathFor(this.fs, conversationId), `${JSON.stringify(line)}\n`).catch((err) => {
      // biome-ignore lint/suspicious/noConsole: fatal audit write failure
      console.error('Fatal: audit write failed', err);
      process.exit(1);
    });
  }

  /** Keep the live index current. Best-effort (write-model §1): the index is a rebuildable projection, so
   *  a failure is logged and swallowed, never propagated. The audit append is the primary, source-of-truth
   *  write and ingest heals any gap from it. The history record must never break the conversation it records. */
  #project(message: HistoryMessage): void {
    try {
      this.index.insert(message);
    } catch (err) {
      logger.error('History index projection failed; the audit holds the message and ingest will heal it', err);
    }
  }

  #message(id: string, conversationId: string, queryId: string, turnId: string, timestamp: string, role: HistoryMessage['role'], content: Parameters<typeof toHistoryBlocks>[0]): HistoryMessage {
    return { id, conversationId, turnId, queryId, timestamp, role, blocks: toHistoryBlocks(content) };
  }
}
