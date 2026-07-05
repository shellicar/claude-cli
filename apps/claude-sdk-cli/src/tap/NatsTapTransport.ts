import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { NatsConnection } from '@nats-io/nats-core';
import { dependsOn } from '@shellicar/core-di-lite';
import { ITapTransport } from './ITapTransport.js';

export class NatsTapTransport extends ITapTransport {
  @dependsOn(ILogger) private readonly logger!: ILogger;
  #nc: NatsConnection | null = null;

  public async connect(url: string): Promise<void> {
    // Loaded lazily so a disabled tap never pulls the NATS client into the runtime (the type import
    // above is erased at compile time). The pure-JS transport-node client carries no native deps.
    const { connect } = await import('@nats-io/transport-node');
    // Auto-reconnect with a publish buffer is on by default; that is the mid-run tolerance the spec asks
    // for. The initial connect rejects when the broker is unreachable — the fail-fast path.
    this.#nc = await connect({ servers: url });
  }

  public publish(subject: string, payload: Uint8Array): void {
    // A publish after a mid-run drop must never throw into the conversation. The client buffers while
    // reconnecting; if there is genuinely no connection we drop and log, never raise.
    try {
      this.#nc?.publish(subject, payload);
    } catch (err) {
      this.logger.warn('tap publish failed (dropped)', { error: String(err) });
    }
  }

  public async close(): Promise<void> {
    await this.#nc?.drain();
    this.#nc = null;
  }
}