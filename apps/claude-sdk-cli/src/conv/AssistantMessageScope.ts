import { randomUUID } from 'node:crypto';

/**
 * Mints and holds the id of the assistant's message, so the audit and the change publisher name it the
 * same way: the response is recorded the moment it lands and announced after it is persisted, and one
 * message read as two is the divergence this exists to stop.
 *
 * A message id names an occurrence in the dialogue, not a service response, so it is minted here rather
 * than taken from the API's `msg.id`: content is revisable, and a revision under a stable id has no new
 * API response to borrow one from. Registered abstract→concrete (DI rule).
 */
export abstract class IAssistantMessageScope {
  public abstract get messageId(): string | undefined;
  public abstract begin(): string;
}

export class AssistantMessageScope extends IAssistantMessageScope {
  #messageId: string | undefined;

  public get messageId(): string | undefined {
    return this.#messageId;
  }

  public begin(): string {
    this.#messageId = randomUUID();
    return this.#messageId;
  }
}
