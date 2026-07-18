import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Clock } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { dependsOn } from '@shellicar/core-di-lite';
import { IBus } from '../bus/IBus.js';
import type { sdkConfigSchema } from '../cli-config/schema.js';
import { stamp } from '../conv/wire.js';

/** The presence contract; register abstract\u2192concrete and depend on the abstract (DI rule). */
export abstract class IAgentPresence {
  public abstract readonly instanceId: string;
  public abstract readonly world: string;
  /** Publish `ready` and start pulsing. Call once, after subscriptions are up (agent-spec). */
  public abstract boot(): void;
  /** This instance now serves `conversationId` at `cwd`. Re-publish on a `cwd` move (last-write-wins). */
  public abstract attach(conversationId: string, cwd: string): void;
  /** Released, deliberately \u2014 Ctrl-C, drain, done. A crash publishes nothing (agent-spec). */
  public abstract detach(conversationId: string): void;
  /** Stop pulsing \u2014 called once on clean shutdown, after every conversation has detached. */
  public abstract stop(): void;
}

/**
 * The agent concern's telemetry face: `ready` once on boot, a `pulse` liveness promise on an interval,
 * and `attached`/`detached` around this instance's conversation binding. `instanceId` is minted fresh
 * per process (agent-spec: an instance's lifetime is its own, and a restarted bridge is a new instance in
 * the same world). Zero effect when the bus is disabled (IBus.publish is a no-op then).
 */
export class AgentPresence extends IAgentPresence {
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(Clock) private readonly clock!: Clock;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<typeof sdkConfigSchema>;
  public readonly instanceId = randomUUID();
  #pulse: NodeJS.Timeout | null = null;

  public get world(): string {
    return this.configLoader.config.nats.world;
  }

  public boot(): void {
    this.bus.publish(`agent.v1.${this.world}.telemetry.ready`, stamp(this.clock, { instanceId: this.instanceId, host: hostname() }));
    const intervalS = this.configLoader.config.nats.pulseIntervalS;
    this.#pulse = setInterval(() => {
      this.bus.publish(`agent.v1.${this.world}.telemetry.pulse`, stamp(this.clock, { instanceId: this.instanceId, intervalS }));
    }, intervalS * 1000);
    this.#pulse.unref();
  }

  public attach(conversationId: string, cwd: string): void {
    this.bus.publish(`agent.v1.${this.world}.telemetry.attached`, stamp(this.clock, { instanceId: this.instanceId, conversationId, cwd }));
  }

  public detach(conversationId: string): void {
    this.bus.publish(`agent.v1.${this.world}.telemetry.detached`, stamp(this.clock, { instanceId: this.instanceId, conversationId }));
  }

  public stop(): void {
    if (this.#pulse != null) {
      clearInterval(this.#pulse);
    }
    this.#pulse = null;
  }
}
