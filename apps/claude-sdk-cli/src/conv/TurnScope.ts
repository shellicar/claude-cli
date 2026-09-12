import { randomUUID } from 'node:crypto';

/** Reads the live turn's id; telemetry and the approval raise stamp their events with it. */
export abstract class ICurrentTurnId {
  public abstract get turnId(): string | undefined;
}

/** Opens a turn: one API round, a user-role message in and an assistant message out. Opened on
 *  `query_summary`, which fires once per request and synchronously with it, so a request re-sent
 *  after a rolled-back assistant turn opens a new turn. Tying the mint to a newly committed user
 *  message instead would have to run inside the fire-and-forget persist, which races the telemetry
 *  that reads the id. Registered abstract→concrete (DI rule). */
export abstract class ITurnScope extends ICurrentTurnId {
  public abstract begin(): string;
}

export class TurnScope extends ITurnScope {
  #turnId: string | undefined;

  public get turnId(): string | undefined {
    return this.#turnId;
  }

  public begin(): string {
    this.#turnId = randomUUID();
    return this.#turnId;
  }
}
