import { randomUUID } from 'node:crypto';
import { Clock, OffsetDateTime } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di-lite';
import type { sdkConfigSchema } from '../cli-config/schema.js';
import { ITap } from './ITap.js';
import { ITapTransport } from './ITapTransport.js';
import type { TapEvent, TapEventBody } from './TapEvent.js';

// The spec's heartbeat cadence (~15s): silence longer than this is how a consumer reads a run as stale.
const HEARTBEAT_MS = 15_000;

// Bodies the tap emits itself, minus the run/ts the tap stamps. Kept apart from TapEventBody (the
// projector's output) so run_started/run_ended/heartbeat are the tap's alone. The omit is distributive
// so each union member keeps its own fields (a bare Omit over a union collapses to the shared keys).
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type TapLifecycleBody = DistributiveOmit<TapEvent, 'run' | 'ts'>;

export class NatsTap extends ITap {
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<typeof sdkConfigSchema>;
  @dependsOn(ITapTransport) private readonly transport!: ITapTransport;
  @dependsOn(Clock) private readonly clock!: Clock;
  @dependsOn(ILogger) private readonly logger!: ILogger;

  #enabled = false;
  #run = '';
  #subject = '';
  #heartbeat: NodeJS.Timeout | null = null;

  get #config() {
    return this.configLoader.config.tap;
  }

  public async start(conv: string): Promise<void> {
    if (!this.#config.enabled) {
      return; // disabled = zero effect: no connection, no NATS dependency loaded
    }
    this.#run = randomUUID();
    this.#subject = `tap.v1.${conv}.events`;
    // Fail-fast: a rejection here propagates out of runApp to entry/main.ts, which prints and exits 1.
    // A session that silently becomes invisible is the failure the spec refuses.
    await this.transport.connect(this.#config.url);
    this.#enabled = true;
    this.logger.info('tap connected', { url: this.#config.url, conv });
    this.#send({ type: 'run_started', conv, pid: process.pid, label: this.#config.label });
    this.#heartbeat = setInterval(() => this.#send({ type: 'heartbeat' }), HEARTBEAT_MS);
    this.#heartbeat.unref();
  }

  public publish(body: TapEventBody): void {
    if (!this.#enabled) {
      return;
    }
    this.#send(body);
  }

  public async stop(reason: string): Promise<void> {
    if (!this.#enabled) {
      return;
    }
    this.#enabled = false;
    if (this.#heartbeat !== null) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = null;
    }
    this.#send({ type: 'run_ended', reason });
    await this.transport.close();
  }

  // One place owns the wire framing: stamp run + ts, serialise to UTF-8 JSON, hand to the transport.
  // ts is an OffsetDateTime, not a bare Instant: the spec's ts is ISO-8601 with a real UTC offset
  // (the worked example is +10:00), and OffsetDateTime.now derives the offset from the clock's zone.
  #send(body: TapLifecycleBody | TapEventBody): void {
    const event = { ...body, run: this.#run, ts: OffsetDateTime.now(this.clock).toString() } as TapEvent;
    this.transport.publish(this.#subject, new TextEncoder().encode(JSON.stringify(event)));
  }
}