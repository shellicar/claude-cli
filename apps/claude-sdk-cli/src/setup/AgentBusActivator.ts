import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { dependsOn } from '@shellicar/core-di';
import { IAgentPresence } from '../agent/AgentPresence.js';
import { IAgentServe } from '../agent/AgentServe.js';
import { IBus } from '../bus/IBus.js';
import { IConvServe } from '../conv/ConvServe.js';
import { IConversationSession } from '../model/ConversationSession.js';

/** The activator's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IAgentBusActivator {
  public abstract activate(): Promise<void>;
}

/**
 * Connects the one NATS bus and binds this process's two addressable faces to it: the
 * conversation's wire `say`/`cancel` subject (`IConvServe`, re-pointed on `/new`), and the agent
 * world's own ready/pulse/service/drain/chdir surface (`IAgentServe`, `IAgentPresence`) — "this
 * process serves this conversation", bound once at startup.
 *
 * Was inline in `main.ts`'s `runApp`. Extracted so its dependencies are declared, not hand-resolved,
 * and so `buildContainer(...).validate()` sees this wiring.
 */
export class AgentBusActivator extends IAgentBusActivator {
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(IConvServe) private readonly convServe!: IConvServe;
  @dependsOn(IAgentPresence) private readonly agentPresence!: IAgentPresence;
  @dependsOn(IAgentServe) private readonly agentServe!: IAgentServe;
  @dependsOn(IFileSystem) private readonly fileSystem!: IFileSystem;
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;

  // When enabled and the broker is unreachable, bus.start() throws, propagating to entry/main.ts
  // which prints and exits 1. Disabled: start() returns before any connection or NATS import.
  public async activate(): Promise<void> {
    await this.bus.start();
    this.convServe.bind(this.session.id);
    this.agentServe.bind();
    this.agentPresence.boot();
    this.agentPresence.attach(this.session.id, this.fileSystem.cwd());
  }
}
