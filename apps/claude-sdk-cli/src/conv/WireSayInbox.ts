import type { Sender } from '@shellicar/claude-sdk';

/** An accepted wire say waiting for the main loop to pick it up. */
export type AcceptedSay = { text: string; queryId: string; from: Sender };

/** The one-slot hand-off's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IWireSayInbox {
  public abstract deliver(say: AcceptedSay): void;
  public abstract next(): Promise<AcceptedSay>;
}

/**
 * A one-slot async hand-off from the servicer's serve callback (which runs on the bus's delivery) to
 * the main loop's await. At most one say is ever in flight — acceptance is gated on idle by the servicer
 * (plan §1.4) — so a single pending slot is sufficient; there is no queue to build.
 */
export class WireSayInbox extends IWireSayInbox {
  #waiter: ((say: AcceptedSay) => void) | null = null;
  #pending: AcceptedSay | null = null;

  /** The servicer calls this the moment it accepts a say. */
  public deliver(say: AcceptedSay): void {
    if (this.#waiter != null) {
      const waiter = this.#waiter;
      this.#waiter = null;
      waiter(say);
    } else {
      // Accepted between loop iterations; the next `next()` takes it.
      this.#pending = say;
    }
  }

  /** The main loop awaits this; resolves when a say is (or has already been) accepted. */
  public next(): Promise<AcceptedSay> {
    if (this.#pending != null) {
      const pending = this.#pending;
      this.#pending = null;
      return Promise.resolve(pending);
    }
    return new Promise((resolve) => {
      this.#waiter = resolve;
    });
  }
}
