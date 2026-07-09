import type { Sender } from '@shellicar/claude-sdk';

/** An accepted wire say waiting for the main loop to pick it up. */
export type AcceptedSay = { text: string; queryId: string; from: Sender };

/**
 * Stub. The Builder implements the one-slot async hand-off from the serve callback to the main loop's
 * await: `deliver` from the servicer on acceptance, `next` awaited by the loop (plan §1.2). At most one
 * say is ever in flight — acceptance is gated on idle.
 */
export class WireSayInbox {
  public deliver(say: AcceptedSay): void {
    throw new Error('not implemented');
  }

  public next(): Promise<AcceptedSay> {
    throw new Error('not implemented');
  }
}
