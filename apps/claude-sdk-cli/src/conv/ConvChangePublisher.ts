import { Clock } from '@js-joda/core';
import { Conversation } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import { IBus } from '../bus/IBus.js';
import { stamp } from './wire.js';

/**
 * Publishes `message` changes for rows committed to the jsonl, after persistence — appearance on
 * `changes` is the definition of "in the conversation" (conversation-spec). A count watermark: after each
 * persist, publish every item past the last-published count. Messages only append; the sole removal is a
 * never-committed corrupt assistant turn, whose identity never reached the count.
 */
export class ConvChangePublisher {
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
      this.bus.publish(`conv.v1.${conversationId}.changes`, stamp(this.clock, { type: 'message', id: id.messageId, queryId: id.queryId, turnId: id.turnId, role: item.msg.role, from: id.from, content }));
    }
    this.#published = items.length;
  }
}
