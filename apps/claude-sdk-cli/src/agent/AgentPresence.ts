import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Clock } from '@js-joda/core';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { dependsOn } from '@shellicar/core-di';
import { IBus } from '../bus/IBus.js';
import type { sdkConfigSchema } from '../cli-config/schema.js';
import { stamp } from '../conv/wire.js';

/** The presence contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IAgentPresence {
  public abstract readonly instanceId: string;
  public abstract readonly world: string;
  /** Publish `ready` and start pulsing. Call once, after subscriptions are up (agent-spec). */
  public abstract boot(): void;
  /** Open this instance's claim on `conversationId`: publish `attached` on the conversation's own
   *  attachment leaf, exactly once per claim (agent-spec, Attachment) — a re-call while the claim is
   *  open is a no-op, never a second `attached`. Carries the identity pair (world, instanceId), `cwd`,
   *  the liveness promise `intervalS`, and the conversation's `tip` so an observer knows where the
   *  conversation stands without replaying the change stream. */
  public abstract attach(conversationId: string, cwd: string, tip: string | null): void;
  /** The working directory changed under the open claim: publish `moved` — a fact about the standing
   *  claim, never a second `attached` (conversation-spec, Attachment). No open claim: no-op. */
  public abstract move(conversationId: string, cwd: string): void;
  /** Released, deliberately — Ctrl-C, drain, done, or standing down after displacement. Publishes
   *  `detached` and closes the claim; a crash publishes nothing (agent-spec). */
  public abstract detach(conversationId: string): void;
  /** Whether this instance currently holds an open claim on `conversationId` — the gate change
   *  publishers consult so a displaced instance stops committing (agent-spec, Attachment). */
  public abstract hasClaim(conversationId: string): boolean;
  /** Stop pulsing — called once on clean shutdown, after every conversation has detached. */
  public abstract stop(): void;
}

/**
 * The agent's presence on the wire: `ready` once on boot and a `pulse` liveness promise on an interval,
 * both on the world's own telemetry tree, plus the conversation attachment claim — `attached`/`moved`/
 * `detached` on `conv.v2.{id}.attachment.>`, the conversation's own tree (conversation-spec, Attachment).
 * `instanceId` is minted fresh per process (agent-spec: a restarted process is a new instance in the
 * same world). Zero effect when the bus is disabled (IBus.publish is a no-op then).
 */
export class AgentPresence extends IAgentPresence {
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(Clock) private readonly clock!: Clock;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<typeof sdkConfigSchema>;
  public readonly instanceId = randomUUID();
  #pulse: NodeJS.Timeout | null = null;
  readonly #claims = new Set<string>();

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

  public attach(conversationId: string, cwd: string, tip: string | null): void {
    if (this.#claims.has(conversationId)) {
      return; // exactly once per open claim — a second attached is the violation shape (agent-spec)
    }
    this.#claims.add(conversationId);
    this.bus.publish(`conv.v2.${conversationId}.attachment.attached`, stamp(this.clock, { instanceId: this.instanceId, world: this.world, cwd, tip, intervalS: this.configLoader.config.nats.pulseIntervalS }));
  }

  public move(conversationId: string, cwd: string): void {
    if (!this.#claims.has(conversationId)) {
      return;
    }
    this.bus.publish(`conv.v2.${conversationId}.attachment.moved`, stamp(this.clock, { instanceId: this.instanceId, world: this.world, cwd }));
  }

  public detach(conversationId: string): void {
    if (!this.#claims.delete(conversationId)) {
      return;
    }
    this.bus.publish(`conv.v2.${conversationId}.attachment.detached`, stamp(this.clock, { instanceId: this.instanceId, world: this.world }));
  }

  public hasClaim(conversationId: string): boolean {
    return this.#claims.has(conversationId);
  }

  public stop(): void {
    if (this.#pulse != null) {
      clearInterval(this.#pulse);
    }
    this.#pulse = null;
  }
}
