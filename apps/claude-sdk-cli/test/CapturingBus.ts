import { type BusReply, IBus, type ServeHandler } from '../src/bus/IBus.js';

/** One captured publish: the subject and the decoded body. */
export type Captured = { subject: string; body: Record<string, unknown> };

/** NATS-style single-token (`*`) wildcard match, for driving a `serve` bound on a wildcard subject. */
const matchesSubject = (pattern: string, subject: string): boolean => {
  const patternTokens = pattern.split('.');
  const subjectTokens = subject.split('.');
  if (patternTokens.length !== subjectTokens.length) {
    return false;
  }
  return patternTokens.every((token, i) => token === '*' || token === subjectTokens[i]);
};

/**
 * An in-memory IBus for conformance tests — the capture seam, no broker. `publish` records the bytes;
 * `serve` keeps the handler by subject so a servicer test can drive request/reply without a wire.
 */
export class CapturingBus extends IBus {
  public readonly published: Captured[] = [];
  public readonly serves = new Map<string, ServeHandler>();
  /** Objects the fake transit store holds, keyed `bucket/id`. */
  public readonly objects = new Map<string, Uint8Array>();

  public async start(): Promise<void> {}

  public publish(subject: string, payload: Uint8Array): void {
    this.published.push({ subject, body: JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown> });
  }

  public readonly subscriptions = new Map<string, (subject: string, payload: Uint8Array) => void>();

  public subscribe(subject: string, handler: (subject: string, payload: Uint8Array) => void): () => void {
    this.subscriptions.set(subject, handler);
    return () => this.subscriptions.delete(subject);
  }

  /** Deliver a message to a matching subscription, as the broker would. */
  public deliver(subject: string, payload: Uint8Array): void {
    for (const [pattern, handler] of this.subscriptions) {
      if (matchesSubject(pattern, subject)) {
        handler(subject, payload);
      }
    }
  }

  public async request(): Promise<BusReply> {
    return { noResponders: true };
  }

  public serve(subject: string, handler: ServeHandler): () => void {
    this.serves.set(subject, handler);
    return () => this.serves.delete(subject);
  }

  /** Drive a served subject as NATS would: match a wildcard-bound serve and invoke it with the caller's
   *  exact subject (v2's request handlers route on the leaf they actually received). */
  public callServe(subject: string, payload: Uint8Array): Uint8Array | Promise<Uint8Array> | undefined {
    for (const [pattern, handler] of this.serves) {
      if (matchesSubject(pattern, subject)) {
        return handler(payload, subject);
      }
    }
    return undefined;
  }

  public async fetchObject(bucket: string, id: string): Promise<Uint8Array | null> {
    return this.objects.get(`${bucket}/${id}`) ?? null;
  }

  public async stop(): Promise<void> {}
}
