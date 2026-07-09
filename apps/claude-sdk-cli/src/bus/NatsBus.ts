import type { Msg, NatsConnection } from '@nats-io/nats-core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di-lite';
import type { sdkConfigSchema } from '../cli-config/schema.js';
import { type BusReply, IBus, type ServeHandler } from './IBus.js';

/**
 * One NATS connection behind four faces. The connect/reconnect/disabled-is-zero-effect behaviour is
 * `NatsTapTransport`'s, verbatim; `request`/`serve` are the widening the participant stage needs over
 * the tap's publish-only transport. An error from the wire is a returned value, never thrown into a
 * conversation (nats-spec).
 */
export class NatsBus extends IBus {
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<typeof sdkConfigSchema>;
  @dependsOn(ILogger) private readonly logger!: ILogger;
  #nc: NatsConnection | null = null;

  get #config() {
    return this.configLoader.config.nats;
  }

  public async start(): Promise<void> {
    if (!this.#config.enabled) {
      return; // zero effect: no connection, and the NATS client is never imported
    }
    // Loaded lazily so a disabled bus never pulls the NATS client into the runtime. maxReconnectAttempts
    // -1 reconnects forever (a broker restart must not detach a long-lived session); the initial connect
    // still rejects on an unreachable broker (fail-fast startup), propagating out of runApp.
    const { connect } = await import('@nats-io/transport-node');
    this.#nc = await connect({ servers: this.#config.url, maxReconnectAttempts: -1 });
    this.logger.info('bus connected', { url: this.#config.url });
  }

  public publish(subject: string, payload: Uint8Array): void {
    // A publish after a mid-run drop must never throw into the conversation. The client buffers while
    // reconnecting; with genuinely no connection we drop and log, never raise.
    try {
      this.#nc?.publish(subject, payload);
    } catch (err) {
      this.logger.warn('bus publish failed (dropped)', { error: String(err) });
    }
  }

  public subscribe(subject: string, handler: (subject: string, payload: Uint8Array) => void): () => void {
    if (this.#nc == null) {
      return () => {};
    }
    const sub = this.#nc.subscribe(subject, {
      callback: (err, msg: Msg) => {
        if (err == null) {
          handler(msg.subject, msg.data);
        }
      },
    });
    return () => sub.unsubscribe();
  }

  public async request(subject: string, payload: Uint8Array, timeoutMs: number): Promise<BusReply> {
    if (this.#nc == null) {
      return { noResponders: true };
    }
    try {
      const msg = await this.#nc.request(subject, payload, { timeout: timeoutMs });
      return { data: msg.data };
    } catch (err) {
      // NATS surfaces "no responders" as error code 503; anything else here is a timeout. Both are
      // lawful returned outcomes, never thrown into a conversation (errors from the wire never enter it).
      return (err as { code?: string }).code === '503' ? { noResponders: true } : { timeout: true };
    }
  }

  public serve(subject: string, handler: ServeHandler): () => void {
    if (this.#nc == null) {
      return () => {};
    }
    const sub = this.#nc.subscribe(subject, {
      callback: (err, msg: Msg) => {
        if (err != null || msg.reply == null) {
          return; // no reply subject means nothing to answer; a delivery error is dropped, never thrown
        }
        try {
          msg.respond(handler(msg.data));
        } catch (e) {
          // A throwing handler must still reply, or the requester waits out its full timeout. Reply with an
          // error marker so the caller fails fast. Inert today — both live handlers catch internally and
          // always return bytes — so this closes a latent gap without changing their behaviour.
          this.logger.warn('serve handler threw', { subject, error: String(e) });
          msg.respond(new TextEncoder().encode(JSON.stringify({ rejected: true, reason: 'internal_error' })));
        }
      },
    });
    return () => sub.unsubscribe();
  }

  public async stop(): Promise<void> {
    await this.#nc?.drain();
    this.#nc = null;
  }
}
