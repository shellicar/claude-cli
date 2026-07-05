import type { TapEventBody } from './TapEvent.js';

/** The tap: observes the conversation and publishes spec v1 events. Disabled is the whole point of stage 1 —
 * a disabled tap connects to nothing, loads no NATS dependency, and publishes nothing. */
export abstract class ITap {
  /** Connect when enabled and announce the run. Throws when enabled and the broker is unreachable
   * (fail-fast, once, loudly). No-op — and no NATS module loaded — when disabled. */
  public abstract start(conv: string): Promise<void>;
  /** Project one observed event onto the wire. No-op when disabled or not connected. */
  public abstract publish(body: TapEventBody): void;
  /** The process switched to a new conversation (the CLI's `/new`). A run is process + conversation, so
   * this ends the current run cleanly and starts a new one on the new conversation's subject. No-op when
   * disabled or not connected. */
  public abstract switchConversation(conv: string): void;
  /** Announce a clean exit and drain. No-op when disabled. */
  public abstract stop(reason: string): Promise<void>;
}
