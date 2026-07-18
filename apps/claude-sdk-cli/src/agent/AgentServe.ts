import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { dependsOn } from '@shellicar/core-di-lite';
import { IBus } from '../bus/IBus.js';
import type { sdkConfigSchema } from '../cli-config/schema.js';
import { IAgentServicer } from './AgentServicer.js';

/** Owns the world's addressable serve binding (`agent.v1.{world}.requests.*`). Unlike the conversation
 *  binding, the world never moves for the process's lifetime, so this binds once at boot. */
export abstract class IAgentServe {
  public abstract bind(): void;
}

export class AgentServe extends IAgentServe {
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(IAgentServicer) private readonly servicer!: IAgentServicer;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<typeof sdkConfigSchema>;

  public bind(): void {
    const world = this.configLoader.config.nats.world;
    this.bus.serve(`agent.v1.${world}.requests.*`, (payload, subject) => this.servicer.handle(payload, subject));
  }
}
