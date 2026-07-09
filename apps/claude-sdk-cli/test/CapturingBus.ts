import { type BusReply, IBus, type ServeHandler } from '../src/bus/IBus.js';

/** One captured publish: the subject and the decoded body. */
export type Captured = { subject: string; body: Record<string, unknown> };

/**
 * An in-memory IBus for conformance tests — the capture seam, no broker. `publish` records the bytes;
 * `serve` keeps the handler by subject so a servicer test can drive request/reply without a wire.
 */
export class CapturingBus extends IBus {
  public readonly published: Captured[] = [];
  public readonly serves = new Map<string, ServeHandler>();

  public async start(): Promise<void> {}

  public publish(subject: string, payload: Uint8Array): void {
    this.published.push({ subject, body: JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown> });
  }

  public subscribe(): () => void {
    return () => {};
  }

  public async request(): Promise<BusReply> {
    return { noResponders: true };
  }

  public serve(subject: string, handler: ServeHandler): () => void {
    this.serves.set(subject, handler);
    return () => this.serves.delete(subject);
  }

  public async stop(): Promise<void> {}
}
