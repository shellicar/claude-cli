import { Clock } from '@js-joda/core';
import { Conversation } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import { IBus } from '../bus/IBus.js';
import { stamp } from './wire.js';

/** `query` closure reasons — an open set under add-only; these are the ones defined today
 *  (conversation-spec). */
export type QueryCloseReason = 'completed' | 'cancelled' | 'aborted';

/** The change publisher's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConvChangePublisher {
  public abstract flush(conversationId: string): void;
  public abstract closeQuery(conversationId: string, queryId: string, reason: QueryCloseReason): void;
}

/**
 * Publishes `message` changes for rows committed to the jsonl, after persistence — appearance on
 * `changes.message` is the definition of "in the conversation" (conversation-spec). A count watermark:
 * after each persist, publish every item past the last-published count. Messages only append; the sole
 * removal is a never-committed corrupt assistant turn, whose identity never reached the count.
 *
 * Also publishes `query` closure — the fact that a query will grow no further, published once its
 * closing reason is known (the caller decides: `end_turn` → completed, an accepted cancel → cancelled,
 * an aborted attempt → aborted).
 */
export class ConvChangePublisher extends IConvChangePublisher {
  @dependsOn(Conversation) private readonly conversation!: Conversation;
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(Clock) private readonly clock!: Clock;
  #published = 0;

  /** Publish `message` changes for newly-committed rows. Called after each saveConversation. */
  public flush(conversationId: string): void {
    const items = this.conversation.items;
    for (let i = this.#published; i < items.length; i++) {
      const item = items[i];
      const id = item?.identity;
      if (id == null) {
        continue; // a legacy row carries no identity — nothing to key a change on
      }
      const content = Array.isArray(item.msg.content) ? item.msg.content : [{ type: 'text', text: item.msg.content }];
      this.bus.publish(`conv.v2.${conversationId}.changes.message`, stamp(this.clock, { id: id.messageId, queryId: id.queryId, turnId: id.turnId, role: item.msg.role, from: id.from, content }));
    }
    this.#published = items.length;
  }

  /** Publish the `query` closure change — committal like every change: the caller publishes it only
   *  after the closing fact (the closing round's commit, or an accepted cancel) is already in the record. */
  public closeQuery(conversationId: string, queryId: string, reason: QueryCloseReason): void {
    this.bus.publish(`conv.v2.${conversationId}.changes.query`, stamp(this.clock, { queryId, reason }));
  }
}
