import { dependsOn } from '@shellicar/core-di-lite';
import { IBus } from '../bus/IBus.js';
import { IConvServicer } from './ConvServicer.js';

/**
 * Owns the conversation's addressable serve binding (`conv.v1.{id}.requests`). A run is process +
 * conversation, so when the conversation switches (`/new`) the addressable subject moves with it:
 * `bind` disposes the previous serve and serves the new id, so the new conversation is reachable over
 * NATS immediately rather than only after a relaunch. Publishes already follow the switch on their own
 * (their subjects interpolate the live `session.id`); only the serve binding needs re-pointing.
 */
export abstract class IConvServe {
  public abstract bind(conversationId: string): void;
}

export class ConvServe extends IConvServe {
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(IConvServicer) private readonly servicer!: IConvServicer;
  #dispose: (() => void) | null = null;

  public bind(conversationId: string): void {
    this.#dispose?.();
    this.#dispose = this.bus.serve(`conv.v1.${conversationId}.requests`, (payload) => this.servicer.handle(payload));
  }
}
