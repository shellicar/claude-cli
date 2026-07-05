import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di-lite';
import { ITapTransport } from './ITapTransport.js';

export class NatsTapTransport extends ITapTransport {
  @dependsOn(ILogger) private readonly logger!: ILogger;

  // Scaffold stub: the Builder lazily imports the pure-JS NATS client here (so a disabled tap loads
  // nothing), wires auto-reconnect for mid-run tolerance, and rejects on an unreachable broker.
  public async connect(_url: string): Promise<void> {
    throw new Error('not implemented');
  }

  public publish(_subject: string, _payload: Uint8Array): void {
    throw new Error('not implemented');
  }

  public async close(): Promise<void> {
    throw new Error('not implemented');
  }
}
