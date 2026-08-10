import { Clock } from '@js-joda/core';
import { type HistoryItem, IConversation, type Sender } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { AuditWriter } from '../AuditWriter.js';
import { IBus } from '../bus/IBus.js';
import { stamp } from './wire.js';

/** `query` closure reasons — an open set under add-only; these are the ones defined today
 *  (conversation-spec). */
export type QueryCloseReason = 'completed' | 'cancelled' | 'aborted';

/** The conversation's tip: the id of the last message published on `changes.message`, `null` when
 *  none has been. A `say` states this as its premise, so it has to be the id the wire actually saw. */
export abstract class IPublishedTip {
  public abstract get tip(): string | null;
}

/** The change publisher's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConvChangePublisher extends IPublishedTip {
  public abstract adopt(tip: string | null): void;
  public abstract commitUserMessage(conversationId: string, messageId: string, queryId: string, turnId: string, from?: Sender): void;
  public abstract publishAssistantMessage(conversationId: string, messageId: string, queryId: string, turnId: string): void;
  public abstract closeQuery(conversationId: string, queryId: string, reason: QueryCloseReason): void;
}

/**
 * Publishes `message` changes for rows committed to the jsonl, after persistence — appearance on
 * `changes.message` is the definition of "in the conversation" (conversation-spec).
 *
 * A caller publishes the conversation's tip under an id it hands in, rather than the publisher
 * walking the message array: an id is minted per message where the message is recorded, and the
 * array holds none. That is also what keeps a loaded conversation off the wire — its rows were
 * published by whichever process committed them, and nothing here is ever told to publish them again.
 *
 * Also publishes `query` closure — the fact that a query will grow no further, published once its
 * closing reason is known (the caller decides: `end_turn` → completed, an accepted cancel → cancelled,
 * an aborted attempt → aborted).
 */
export class ConvChangePublisher extends IConvChangePublisher {
  @dependsOn(IConversation) private readonly conversation!: IConversation;
  @dependsOn(AuditWriter) private readonly audit!: AuditWriter;
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(Clock) private readonly clock!: Clock;
  #tip: string | null = null;
  #lastPublished: HistoryItem | undefined;
  #lastClosedQueryId: string | null = null;

  public get tip(): string | null {
    return this.#tip;
  }

  /** Take up a conversation that was already committed elsewhere: its tip comes from the durable
   *  record, and its last row counts as published so a message merged onto it is not published twice. */
  public adopt(tip: string | null): void {
    this.#tip = tip;
    this.#lastPublished = this.conversation.items.at(-1);
  }

  /** Commit the conversation's tip under `messageId`: record it in the audit, then announce it. Both or
   *  neither, decided once here, so the durable record and the wire hold the same set of messages and a
   *  resumed conversation can read its tip back out of the audit.
   *
   *  A no-op when the tip is the row already committed: consecutive user messages merge into that row
   *  rather than appending a new one, so there is no new message. */
  public commitUserMessage(conversationId: string, messageId: string, queryId: string, turnId: string, from?: Sender): void {
    const item = this.conversation.items.at(-1);
    if (item === undefined || item === this.#lastPublished) {
      return;
    }
    this.audit.writeUser(conversationId, item.msg, messageId, queryId, turnId);
    this.#announce(conversationId, item, messageId, queryId, turnId, from);
  }

  /** Announce the assistant's message. No audit write: it was recorded the moment the response
   *  completed, which is deliberately earlier than this (see `AuditWriter.writeAssistant`). */
  public publishAssistantMessage(conversationId: string, messageId: string, queryId: string, turnId: string): void {
    const item = this.conversation.items.at(-1);
    if (item === undefined || item === this.#lastPublished) {
      return;
    }
    this.#announce(conversationId, item, messageId, queryId, turnId, { kind: 'agent' });
  }

  #announce(conversationId: string, item: HistoryItem, messageId: string, queryId: string, turnId: string, from: Sender | undefined): void {
    const content = Array.isArray(item.msg.content) ? item.msg.content : [{ type: 'text', text: item.msg.content }];
    // `from` is absent for a tool_result: it is the mechanical delivery of a tool's output, not an
    // utterance, and nobody sent it, so nothing is fabricated to fill the slot (conversation-spec,
    // 19 Jul 2026 correction). A row carrying anything else is something a sender said.
    const mechanical = Array.isArray(item.msg.content) && item.msg.content.every((block) => block.type === 'tool_result');
    const sender = mechanical || from === undefined ? {} : { from };
    this.bus.publish(`conv.v2.${conversationId}.changes.message`, stamp(this.clock, { id: messageId, queryId, turnId, role: item.msg.role, ...sender, content }));
    this.#lastPublished = item;
    this.#tip = messageId;
  }

  /** Publish the `query` closure change — committal like every change: the caller publishes it only
   *  after the closing fact (the closing round's commit, or an accepted cancel) is already in the record.
   *  A query closes once (conversation-spec): a cancel's `closeQuery('cancelled')` and the turn's own
   *  pending close still firing `aborted` for the same queryId must not both reach the wire as two
   *  contradictory closure facts, so the first close for a queryId wins and every later one is dropped.
   *  Remembering only the last closed id suffices: turns run strictly sequentially, so a duplicate close
   *  can only ever be adjacent — an old queryId never comes back. */
  public closeQuery(conversationId: string, queryId: string, reason: QueryCloseReason): void {
    if (queryId === this.#lastClosedQueryId) {
      return;
    }
    this.#lastClosedQueryId = queryId;
    this.bus.publish(`conv.v2.${conversationId}.changes.query`, stamp(this.clock, { queryId, reason }));
  }
}
