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

/** Commits a message: records it and announces it, as one act. */
export abstract class IMessageCommitter {
  public abstract commitUser(conversationId: string, msg: BetaMessageParam, messageId: string, queryId: string, turnId: string, from?: Sender): void;
  public abstract commitAssistant(conversationId: string, messageId: string, queryId: string, turnId: string): void;
}

/** Publishes the fact that a query will grow no further. */
export abstract class IQueryCloser {
  public abstract closeQuery(conversationId: string, queryId: string, reason: QueryCloseReason): void;
}

/**
 * Commits a message to the conversation's two records: the audit file it is kept in, and
 * `changes.message`, appearance on which is the definition of "in the conversation"
 * (conversation-spec). One call drives both, so they cannot come to hold different sets.
 *
 * A message becomes a message when the model receives it, so the user half is handed in as the
 * request carried it rather than read back off the conversation array. The array is shaped for the
 * API and still mutable at that point: consecutive user messages merge into one row, and a clock
 * stamp and a heal are applied to the tip on the way out. Reading it would record something the
 * model never saw, and a loaded conversation's rows would go out again as if newly said.
 */
export class ConvCommitter extends IMessageCommitter implements IPublishedTip, IConversationAdopter, IQueryCloser {
  @dependsOn(IConversation) private readonly conversation!: IConversation;
  @dependsOn(AuditWriter) private readonly audit!: AuditWriter;
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(Clock) private readonly clock!: Clock;
  #tip: string | null = null;
  #lastClosedQueryId: string | null = null;

  public get tip(): string | null {
    return this.#tip;
  }

  /** Take up a conversation that was already committed elsewhere: its tip comes from the durable record. */
  public adopt(tip: string | null): void {
    this.#tip = tip;
  }

  /** Record the message the request carried, then announce it. */
  public commitUser(conversationId: string, msg: BetaMessageParam, messageId: string, queryId: string, turnId: string, from?: Sender): void {
    this.audit.writeUser(conversationId, msg, messageId, queryId, turnId);
    this.#announce(conversationId, msg, messageId, queryId, turnId, from);
  }

  /** Announce the assistant's message. Its audit line was written the moment the response completed,
   *  deliberately earlier than this: model output cannot be regenerated, so it is recorded before
   *  anything waits on a disk write (see `AuditWriter.writeAssistant`). */
  public commitAssistant(conversationId: string, messageId: string, queryId: string, turnId: string): void {
    const item: HistoryItem | undefined = this.conversation.items.at(-1);
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
