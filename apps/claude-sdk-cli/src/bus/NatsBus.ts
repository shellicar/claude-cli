import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di-lite';
import type { sdkConfigSchema } from '../cli-config/schema.js';
import { type BusReply, IBus, type ServeHandler } from './IBus.js';

/**
 * Stub. The Builder implements the four faces over one lazily-imported NATS connection, verbatim from
 * `NatsTapTransport`'s connect/reconnect/disabled-is-zero-effect pattern (plan §5).
 */
export class NatsBus extends IBus {
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<typeof sdkConfigSchema>;
  @dependsOn(ILogger) private readonly logger!: ILogger;

  public async start(): Promise<void> {
    throw new Error('not implemented');
  }

  public publish(subject: string, payload: Uint8Array): void {
    throw new Error('not implemented');
  }

  public subscribe(subject: string, handler: (subject: string, payload: Uint8Array) => void): () => void {
    throw new Error('not implemented');
  }

  public request(subject: string, payload: Uint8Array, timeoutMs: number): Promise<BusReply> {
    throw new Error('not implemented');
  }

  public serve(subject: string, handler: ServeHandler): () => void {
    throw new Error('not implemented');
  }

  public async stop(): Promise<void> {
    throw new Error('not implemented');
  }
}
