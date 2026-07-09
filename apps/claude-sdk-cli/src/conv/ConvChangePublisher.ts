import { Clock } from '@js-joda/core';
import { Conversation } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import { IBus } from '../bus/IBus.js';

/**
 * Stub. Publishes `message` changes for rows committed to the jsonl, after persistence — appearance on
 * `changes` is the definition of "in the conversation" (conversation-spec). The Builder implements the
 * count-watermark flush over `conversation.items`, reading identity off each new row (plan §3.3).
 */
export class ConvChangePublisher {
  @dependsOn(Conversation) private readonly conversation!: Conversation;
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(Clock) private readonly clock!: Clock;

  /** Publish `message` changes for newly-committed rows. Called after each saveConversation. */
  public flush(conversationId: string): void {
    throw new Error('not implemented');
  }
}
