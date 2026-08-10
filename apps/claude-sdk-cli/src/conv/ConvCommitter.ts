import { randomUUID } from 'node:crypto';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import { Clock } from '@js-joda/core';
import { type HistoryItem, IConversation, type Sender } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { AuditWriter } from '../AuditWriter.js';
import { IBus } from '../bus/IBus.js';
import { stamp } from './wire.js';

/** `query` closure reasons — an open set under add-only; these are the ones defined today
 *  (conversation-spec). */
export type QueryCloseReason = 'completed' | 'cancelled' | 'aborted';

/** The conversation's tip: the id of the last message announced on `changes.message`, `null` when
 *  none has been. A `say` states this as its premise, so it has to be the id the wire actually saw. */
export abstract class IPublishedTip {
  public abstract get tip(): string | null;
}

/** Takes up a conversation committed by some earlier process, at boot or on a switch. */
export abstract class IConversationAdopter {
  public abstract adopt(tip: string | null): void;
}

/**
 * Records and announces messages. The two answer different questions and fire at different moments:
 * the audit holds what an API call carried, so it is written per request; the wire holds what the
 * conversation contains, so it is announced when the conversation is persisted.
 */
export abstract class IMessageCommitter {
  public abstract recordSent(conversationId: string, msg: BetaMessageParam, queryId: string, turnId: string): void;
  public abstract announceTip(conversationId: string, queryId: string, turnId: string, from?: Sender): void;
  public abstract announceAssistant(conversationId: string, messageId: string, queryId: string, turnId: string): void;
}

/** Publishes the fact that a query will grow no further. */
export abstract class IQueryCloser {
  public abstract closeQuery(conversationId: string, queryId: string, reason: QueryCloseReason): void;
}

/**
 * Keeps the conversation's two records: the audit file, and `changes.message`, appearance on which is
 * the definition of "in the conversation" (conversation-spec).
 *
 * A row of the conversation is one message and carries one id, minted here rather than stored on the
 * row. Both records name it by that id, which is what stops one message reading as two. The CLI merges
 * consecutive user messages into a single row because the API requires strict role alternation; that
 * merge grows the row, it does not make a second message, so it must not produce a second id.
 */
export class ConvCommitter extends IMessageCommitter implements IPublishedTip, IConversationAdopter, IQueryCloser {
  @dependsOn(IConversation) private readonly conversation!: IConversation;
  @dependsOn(AuditWriter) private readonly audit!: AuditWriter;
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(Clock) private readonly clock!: Clock;
  #tip: string | null = null;
  #idRow: HistoryItem | undefined;
  #idForRow: string | null = null;
  #lastClosedQueryId: string | null = null;

  public get tip(): string | null {
    return this.#tip;
  }

  /** Take up a conversation that was already committed elsewhere: its tip comes from the durable record. */
  public adopt(tip: string | null): void {
    this.#tip = tip;
  }

  /** The id of the conversation's tip row, minted on first use and held for as long as that row is the
   *  tip. A merge replaces the row's content without replacing the row, so the id survives it. */
  #tipId(): string | null {
    const item = this.conversation.items.at(-1);
    if (item === undefined) {
      return null;
    }
    if (item !== this.#idRow) {
      this.#idRow = item;
      this.#idForRow = randomUUID();
    }
    return this.#idForRow;
  }

  /** Write the message an API call carried to the audit. Called per request: a resend after a merge is
   *  another call, and the audit says what each call held. */
  public recordSent(conversationId: string, msg: BetaMessageParam, queryId: string, turnId: string): void {
    const messageId = this.#tipId();
    if (messageId === null) {
      return;
    }
    this.audit.writeUser(conversationId, msg, messageId, queryId, turnId);
  }

  /** Announce the tip on `changes.message` as the conversation now holds it. Called every time the
   *  conversation is persisted, so what the conversation contains is what the wire has. A row that grew
   *  because consecutive user messages merged is announced again under the id it already has: the state
   *  of a message is its latest announcement, last-write-wins per id (conversation-spec), so the fuller
   *  content replaces the earlier rather than adding a second message. */
  public announceTip(conversationId: string, queryId: string, turnId: string, from?: Sender): void {
    const item = this.conversation.items.at(-1);
    if (item === undefined || item.msg.role !== 'user') {
      return;
    }
    const messageId = this.#tipId();
    if (messageId === null) {
      return;
    }
    this.#announce(conversationId, item.msg, messageId, queryId, turnId, from);
  }

  /** Announce the assistant's message. Its audit line was written the moment the response completed,
   *  deliberately earlier than this: model output cannot be regenerated, so it is recorded before
   *  anything waits on a disk write (see `AuditWriter.writeAssistant`). */
  public announceAssistant(conversationId: string, messageId: string, queryId: string, turnId: string): void {
    const item = this.conversation.items.at(-1);
    if (item === undefined || item.msg.role !== 'assistant') {
      return;
    }
    this.#announce(conversationId, item.msg, messageId, queryId, turnId, { kind: 'agent' });
  }

  #announce(conversationId: string, msg: BetaMessageParam, messageId: string, queryId: string, turnId: string, from: Sender | undefined): void {
    const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];
    // `from` is absent for a tool_result: it is the mechanical delivery of a tool's output, not an
    // utterance, and nobody sent it, so nothing is fabricated to fill the slot (conversation-spec,
    // 19 Jul 2026 correction). A row carrying anything else is something a sender said.
    const mechanical = Array.isArray(msg.content) && msg.content.every((block) => block.type === 'tool_result');
    const sender = mechanical || from === undefined ? {} : { from };
    this.bus.publish(`conv.v2.${conversationId}.changes.message`, stamp(this.clock, { id: messageId, queryId, turnId, role: msg.role, ...sender, content }));
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
