import { randomUUID } from 'node:crypto';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { Conversation, type Sender } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import { ConsumerChannel } from '../setup/ConsumerChannel.js';
import { WireSayInbox } from './WireSayInbox.js';
import { encode } from './wire.js';

/**
 * The addressable face of the conversation, serving `conv.v1.{id}.requests`. A `say` is checked against
 * the premise then delivered to the inbox with a minted queryId; `cancel` routes to the existing cancel
 * path; everything else is answered `rejected: unsupported` — compliance is answering, not implementing.
 */
export class ConvServicer {
  @dependsOn(Conversation) private readonly conversation!: Conversation;
  @dependsOn(WireSayInbox) private readonly inbox!: WireSayInbox;
  @dependsOn(ConsumerChannel) private readonly channel!: ConsumerChannel;
  @dependsOn(ILogger) private readonly logger!: ILogger;

  // A turn is live: a say has a live acceptance and is rejected; cancel frees it. Set true at runTurn
  // start and on acceptance (closing the accept→runTurn gap), false at runTurn end.
  #busy = false;

  public setBusy(busy: boolean): void {
    this.#busy = busy;
  }

  /** The bus serve handler body: parse the request, route it, return the reply bytes. */
  public handle(payload: Uint8Array): Uint8Array {
    let req: { type?: string; text?: string; id?: string; from?: Sender; precondition?: { tip?: string } };
    try {
      req = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return encode({ rejected: true, reason: 'unsupported' });
    }

    if (req.type === 'say') {
      const tip = this.conversation.items.at(-1)?.identity?.messageId;
      // A stated premise that does not match the tip is stale (the first say of a fresh conversation
      // carries no premise, so the tip-less case is not rejected here).
      if (req.precondition?.tip != null && req.precondition.tip !== tip) {
        return encode({ rejected: true, reason: 'stale' });
      }
      if (this.#busy) {
        // A turn is live: the premise has a live acceptance. cancel-then-send is the affordance.
        return encode({ rejected: true, reason: 'stale' });
      }
      this.#busy = true; // close the gap before runTurn sets it
      const queryId = randomUUID();
      const from: Sender = req.from ?? { kind: 'human' };
      this.logger.info('say accepted', { queryId });
      this.inbox.deliver({ text: req.text ?? '', queryId, from });
      return encode({ accepted: true, id: queryId });
    }

    if (req.type === 'cancel') {
      if (!this.#busy) {
        return encode({ rejected: true, reason: 'already_complete' });
      }
      this.channel.send({ type: 'cancel' }); // the same path a local ESC uses
      return encode({ accepted: true });
    }

    // revise, history, wire-visible rewind, unknown — answered honestly, not implemented.
    return encode({ rejected: true, reason: 'unsupported' });
  }
}
