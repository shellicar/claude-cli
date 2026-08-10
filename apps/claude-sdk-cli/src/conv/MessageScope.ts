import { randomUUID } from 'node:crypto';

/**
 * Mints and holds the ids of the round's two messages, so the audit and the change publisher stamp
 * the same id on the same message: they record it at different moments, and one message read as two
 * is the divergence this exists to stop.
 *
 * A message id names an occurrence in the dialogue, not a service response, so the assistant's is
 * minted here rather than taken from the API's `msg.id`: content is revisable, and a revision under a
 * stable id has no new API response to borrow one from. Registered abstract→concrete (DI rule).
 */
export abstract class IMessageScope {
  public abstract get userMessageId(): string | undefined;
  public abstract get assistantMessageId(): string | undefined;
  public abstract beginUser(): string;
  public abstract beginAssistant(): string;
}

export class MessageScope extends IMessageScope {
  #userMessageId: string | undefined;
  #assistantMessageId: string | undefined;

  public get userMessageId(): string | undefined {
    return this.#userMessageId;
  }

  public get assistantMessageId(): string | undefined {
    return this.#assistantMessageId;
  }

  public beginUser(): string {
    this.#userMessageId = randomUUID();
    return this.#userMessageId;
  }

  public beginAssistant(): string {
    this.#assistantMessageId = randomUUID();
    return this.#assistantMessageId;
  }
}
