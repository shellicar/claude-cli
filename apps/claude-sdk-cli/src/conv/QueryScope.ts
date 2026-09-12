import { randomUUID } from 'node:crypto';
import type { Sender } from '@shellicar/claude-sdk';

/** Reads the live query's id; the cancel path compares the id it was handed against this one. */
export abstract class ICurrentQueryId {
  public abstract get queryId(): string | undefined;
}

/** Reads who asked. Provenance for the messages this query commits: a wire `say` carries the sender
 *  it was published with, locally-typed input is the operator. Never fabricated. */
export abstract class ICurrentSender {
  public abstract get from(): Sender | undefined;
}

/** Opens a query. `begin` takes no id, so there is no id to carry over from a query that already
 *  ended: a new query cannot reuse a dead one's. Registered abstract→concrete (DI rule). */
export abstract class IQueryScope extends ICurrentQueryId {
  public abstract begin(from: Sender): string;
}

export class QueryScope extends IQueryScope implements ICurrentSender {
  #queryId: string | undefined;
  #from: Sender | undefined;

  public get queryId(): string | undefined {
    return this.#queryId;
  }

  public get from(): Sender | undefined {
    return this.#from;
  }

  public begin(from: Sender): string {
    this.#queryId = randomUUID();
    this.#from = from;
    return this.#queryId;
  }
}
