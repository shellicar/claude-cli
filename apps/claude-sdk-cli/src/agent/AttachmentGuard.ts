import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { dependsOn } from '@shellicar/core-di';
import { IBus } from '../bus/IBus.js';
import { IConvServe } from '../conv/ConvServe.js';
import { IConversationState } from '../model/ConversationState.js';
import { IAgentPresence } from './AgentPresence.js';

/** The guard's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IAttachmentGuard {
  /** Watch `conversationId`'s attachment leaf for displacement. Re-pointed on `/new`, like the serve
   *  binding: the previous watch is disposed and the new conversation's leaf watched instead. */
  public abstract watch(conversationId: string): void;
}

/**
 * A compliant instance watches the attachment leaf of every conversation it serves (agent-spec,
 * Attachment). Another identity's `attached` means this instance is superseded: it stops serving —
 * the wire serve binding is dropped and the open claim closed, which gates further change publishes —
 * publishes `detached` as the observable act of standing down, and tells the user honestly. Identity
 * is the `(world, instanceId)` pair, falling back to bare `instanceId` when either side omits `world`.
 */
export class AttachmentGuard extends IAttachmentGuard {
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(IAgentPresence) private readonly presence!: IAgentPresence;
  @dependsOn(IConvServe) private readonly convServe!: IConvServe;
  @dependsOn(IConversationState) private readonly conversationState!: IConversationState;
  @dependsOn(ILogger) private readonly logger!: ILogger;
  #dispose: (() => void) | null = null;

  public watch(conversationId: string): void {
    this.#dispose?.();
    this.#dispose = this.bus.subscribe(`conv.v2.${conversationId}.attachment.attached`, (_subject, payload) => this.#onAttached(conversationId, payload));
  }

  #onAttached(conversationId: string, payload: Uint8Array): void {
    let claim: { instanceId?: string; world?: string };
    try {
      claim = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return; // not a claim we can read — tolerance, never an error
    }
    if (claim.instanceId == null || !this.presence.hasClaim(conversationId)) {
      return;
    }
    const sameInstance = claim.instanceId === this.presence.instanceId;
    const sameWorld = claim.world == null || claim.world === this.presence.world;
    if (sameInstance && sameWorld) {
      return; // our own claim echoed back
    }
    // Superseded: stop serving, stand down observably, surface it (agent-spec, Attachment).
    this.#dispose?.();
    this.#dispose = null;
    this.convServe.unbind();
    this.presence.detach(conversationId);
    this.logger.info('attachment superseded', { conversationId, by: claim.instanceId, world: claim.world });
    this.conversationState.completeActive();
    this.conversationState.spliceNotice(`⚠️ This conversation is now served by another instance (${claim.world ?? 'unknown world'}). This session has stood down and no longer commits to it.`);
  }
}
