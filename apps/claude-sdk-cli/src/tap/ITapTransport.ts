/** The broker connection, abstracted so the tap is testable without a real NATS server and so the client
 * library stays an implementation detail. */
export abstract class ITapTransport {
  /** Establish the connection. Rejects if the broker is unreachable at connect time (drives fail-fast). */
  public abstract connect(url: string): Promise<void>;
  /** Fire-and-forget publish. The established connection buffers/auto-reconnects; a mid-run outage never throws here. */
  public abstract publish(subject: string, payload: Uint8Array): void;
  /** Flush in-flight publishes and close. Best-effort on shutdown. */
  public abstract close(): Promise<void>;
}
