import { Clock } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di-lite';
import type { sdkConfigSchema } from '../cli-config/schema.js';
import { ITap } from './ITap.js';
import { ITapTransport } from './ITapTransport.js';
import type { TapEventBody } from './TapEvent.js';

export class NatsTap extends ITap {
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<typeof sdkConfigSchema>;
  @dependsOn(ITapTransport) private readonly transport!: ITapTransport;
  @dependsOn(Clock) private readonly clock!: Clock;
  @dependsOn(ILogger) private readonly logger!: ILogger;

  // Scaffold stub: the Builder implements connect + announce (fail-fast when enabled), the
  // run/subject/heartbeat lifecycle, the run+ts stamping, and the disabled = zero-effect guard.
  // Empty bodies here so the conformance tests are red until the projection is built.
  public async start(_conv: string): Promise<void> {}

  public publish(_body: TapEventBody): void {}

  public async stop(_reason: string): Promise<void> {}
}
