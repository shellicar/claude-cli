/** The reply to a `request`: the responder's bytes, or one of the two lawful non-answers. A no-responders
 *  or a timeout is returned, never thrown — errors from the wire never enter a conversation (nats-spec). */
export type BusReply = { data: Uint8Array } | { timeout: true } | { noResponders: true };

/** A `serve` handler: given the request bytes, return the reply bytes. */
export type ServeHandler = (payload: Uint8Array) => Uint8Array;

/**
 * One NATS connection behind four faces. `ITapTransport` (publish only) widened to the request/reply the
 * participant stage needs: publish (fire-and-forget), subscribe (stream), request (the reply reaches the
 * caller), serve (the handler's return is the reply). Disabled = zero effect, as the tap was.
 */
export abstract class IBus {
  public abstract start(): Promise<void>;
  public abstract publish(subject: string, payload: Uint8Array): void;
  public abstract subscribe(subject: string, handler: (subject: string, payload: Uint8Array) => void): () => void;
  public abstract request(subject: string, payload: Uint8Array, timeoutMs: number): Promise<BusReply>;
  public abstract serve(subject: string, handler: ServeHandler): () => void;
  public abstract stop(): Promise<void>;
}
