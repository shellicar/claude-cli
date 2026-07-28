import { randomUUID } from 'node:crypto';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { IConversation, type Sender } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { IBus } from '../bus/IBus.js';
import { ConsumerChannel } from '../setup/ConsumerChannel.js';
import type { AttachmentReferenceBlock } from './WireAttachmentLedger.js';
import { IWireAttachmentLedger } from './WireAttachmentLedger.js';
import { IWireSayInbox, type ResolvedAttachment } from './WireSayInbox.js';
import { encode } from './wire.js';

/** The addressable face's contract; register abstract→concrete and depend on the abstract (DI rule). */
export abstract class IConvServicer {
  public abstract setBusy(busy: boolean): void;
  public abstract handle(payload: Uint8Array, subject: string): Uint8Array | Promise<Uint8Array>;
}

type SayRequest = {
  text?: string;
  id?: string;
  from?: Sender;
  precondition?: { tip?: string | null };
  attachments?: AttachmentReferenceBlock[];
};

/**
 * The addressable face of the conversation, serving `conv.v2.{id}.requests.*`. v2 routes by subject leaf
 * (the token after `requests.`), never a body `type` — `say` and `cancel` are the two defined leaves. A
 * `say` is checked against the premise then delivered to the inbox with a minted queryId; `cancel` routes
 * to the existing cancel path; an unknown leaf is answered `rejected: unsupported` — compliance is
 * answering, not implementing.
 *
 * A say's attachments resolve here, at the servicer's edge, before acceptance: each `object`-source
 * block is fetched from the bucket the block itself names — never ambient config, never a fallback
 * (conversation-spec, say attachments). A fresh block that does not resolve is never ageing: the say
 * rejects `attachment_unavailable` rather than hand the model a placeholder for what the sender just
 * attached.
 */
export class ConvServicer extends IConvServicer {
  @dependsOn(IConversation) private readonly conversation!: IConversation;
  @dependsOn(IWireSayInbox) private readonly inbox!: IWireSayInbox;
  @dependsOn(IWireAttachmentLedger) private readonly ledger!: IWireAttachmentLedger;
  @dependsOn(IBus) private readonly bus!: IBus;
  @dependsOn(ConsumerChannel) private readonly channel!: ConsumerChannel;
  @dependsOn(ILogger) private readonly logger!: ILogger;

  // A turn is live: a say has a live acceptance and is rejected; cancel frees it. Set true at runTurn
  // start and on acceptance (closing the accept→runTurn gap), false at runTurn end.
  #busy = false;

  public setBusy(busy: boolean): void {
    this.#busy = busy;
  }

  /** The bus serve handler body: parse the request, route by subject leaf, return the reply bytes. */
  public handle(payload: Uint8Array, subject: string): Uint8Array | Promise<Uint8Array> {
    const leaf = subject.split('.').at(-1);
    let req: SayRequest;
    try {
      req = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return encode({ rejected: true, reason: 'unsupported' });
    }

    if (leaf === 'say') {
      const premiseFailure = this.#checkSayPremise(req);
      if (premiseFailure != null) {
        return premiseFailure;
      }
      if (req.attachments == null || req.attachments.length === 0) {
        return this.#acceptSay(req, []);
      }
      return this.#resolveThenAcceptSay(req);
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

  /** null when the premise holds and no acceptance is live; otherwise the rejection bytes. */
  #checkSayPremise(req: SayRequest): Uint8Array | null {
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
    return null;
  }

  async #resolveThenAcceptSay(req: SayRequest): Promise<Uint8Array> {
    const resolved: ResolvedAttachment[] = [];
    for (const block of req.attachments ?? []) {
      if (block.source?.type !== 'object') {
        // Source kinds are an open set; a kind this servicer cannot resolve makes the fresh say
        // unresolvable here — never a silent placeholder (conversation-spec, say attachments).
        return encode({ rejected: true, reason: 'attachment_unavailable', detail: `unsupported source type: ${String(block.source?.type)}` });
      }
      const { id, bucket } = block.source;
      if (id == null || id === '' || bucket == null || bucket === '') {
        // No default and no fallback: a block naming no bucket cannot be resolved, full stop.
        return encode({ rejected: true, reason: 'attachment_unavailable', detail: 'attachment reference carries no id or no bucket' });
      }
      const mediaType = block.source.mediaType ?? 'application/octet-stream';
      if (!mediaType.startsWith('image/') && mediaType !== 'application/pdf') {
        // Resolvable bytes the model cannot take are still unusable for THIS say — reject honestly
        // rather than commit an attachment the request build would have to drop.
        return encode({ rejected: true, reason: 'attachment_unavailable', detail: `media type not inlinable by this servicer: ${mediaType}` });
      }
      const bytes = await this.bus.fetchObject(bucket, id);
      if (bytes == null) {
        return encode({ rejected: true, reason: 'attachment_unavailable', detail: `object ${id} not resolvable in bucket ${bucket}` });
      }
      resolved.push({ base64: Buffer.from(bytes).toString('base64'), mediaType, sizeBytes: block.source.size ?? bytes.length });
    }
    // The fetches awaited: re-check the premise before accepting — the conversation may have moved.
    const premiseFailure = this.#checkSayPremise(req);
    if (premiseFailure != null) {
      return premiseFailure;
    }
    return this.#acceptSay(req, resolved);
  }

  #acceptSay(req: SayRequest, resolved: readonly ResolvedAttachment[]): Uint8Array {
    this.#busy = true; // close the gap before runTurn sets it
    const queryId = randomUUID();
    const from: Sender = req.from ?? { kind: 'human' };
    if (req.attachments != null && req.attachments.length > 0) {
      // The committed message carries the reference blocks verbatim, never the bytes (conversation-spec).
      this.ledger.put(queryId, req.attachments);
    }
    this.logger.info('say accepted', { queryId, attachments: resolved.length });
    this.inbox.deliver({ text: req.text ?? '', queryId, from, attachments: resolved.length > 0 ? resolved : undefined });
    return encode({ accepted: true, id: queryId });
  }
}
