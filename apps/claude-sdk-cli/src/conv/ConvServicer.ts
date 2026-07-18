import { randomUUID } from 'node:crypto';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { Conversation, type Sender } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import { ConsumerChannel } from '../setup/ConsumerChannel.js';
import { IWireSayInbox } from './WireSayInbox.js';
import { encode } from './wire.js';

/** The addressable face's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConvServicer {
  public abstract setBusy(busy: boolean): void;
  public abstract handle(payload: Uint8Array, subject: string): Uint8Array;
}

/**
 * The addressable face of the conversation, serving `conv.v2.{id}.requests.*`. v2 routes by subject leaf
 * (the token after `requests.`), never a body `type` — `say` and `cancel` are the two defined leaves. A
 * `say` is checked against the premise then delivered to the inbox with a minted queryId; `cancel` routes
 * to the existing cancel path; an unknown leaf is answered `rejected: unsupported` — compliance is
 * answering, not implementing.
 */
export class ConvServicer extends IConvServicer {
  @dependsOn(Conversation) private readonly conversation!: Conversation;
  @dependsOn(IWireSayInbox) private readonly inbox!: IWireSayInbox;
  @dependsOn(ConsumerChannel) private readonly channel!: ConsumerChannel;
  @dependsOn(ILogger) private readonly logger!: ILogger;

  // A turn is live: a say has a live acceptance and is rejected; cancel frees it. Set true at runTurn
  // start and on acceptance (closing the accept→runTurn gap), false at runTurn end.
  #busy = false;

  public setBusy(busy: boolean): void {
    this.#busy = busy;
  }

  /** The bus serve handler body: parse the request, route by subject leaf, return the reply bytes. */
  public handle(payload: Uint8Array, subject: string): Uint8Array {
    const leaf = subject.split('.').at(-1);
    let req: { text?: string; id?: string; from?: Sender; precondition?: { tip?: string | null } };
    try {
      req = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return encode({ rejected: true, reason: 'unsupported' });
    }

    if (leaf === 'say') {
      const tip = this.conversation.items.at(-1)?.identity?.messageId ?? null;
      // A stated premise that does not match the tip is stale. The premise is required (conversation-spec):
      // a fresh conversation's first say states `{ tip: null }` rather than omitting it.
      const statedTip = req.precondition?.tip ?? null;
      if (statedTip !== tip) {
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

    if (leaf === 'cancel') {
      if (!this.#busy) {
        return encode({ rejected: true, reason: 'already_complete' });
      }
      // A cancel targets its premise, never "whatever is running" (conversation-spec): its id must match
      // the running query, or it names nothing we hold and the honest reply is not_found.
      const runningQueryId = this.conversation.items.at(-1)?.identity?.queryId;
      if (req.id !== runningQueryId) {
        return encode({ rejected: true, reason: 'not_found' });
      }
      this.channel.send({ type: 'cancel' }); // the same path a local ESC uses
      return encode({ accepted: true });
    }

    // revise, history, wire-visible rewind, unknown — answered honestly, not implemented.
    return encode({ rejected: true, reason: 'unsupported' });
  }
}
