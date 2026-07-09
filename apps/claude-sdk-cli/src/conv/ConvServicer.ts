import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { Conversation } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import { ConsumerChannel } from '../setup/ConsumerChannel.js';
import { WireSayInbox } from './WireSayInbox.js';

/**
 * Stub. The addressable face of the conversation on `conv.v1.{id}.requests`. The Builder implements the
 * reply discipline (plan §1.4): `say` checked against the premise then delivered to the inbox with a
 * minted queryId; `cancel` routed to the existing cancel path; everything else `rejected: unsupported`.
 */
export class ConvServicer {
  @dependsOn(Conversation) private readonly conversation!: Conversation;
  @dependsOn(WireSayInbox) private readonly inbox!: WireSayInbox;
  @dependsOn(ConsumerChannel) private readonly channel!: ConsumerChannel;
  @dependsOn(ILogger) private readonly logger!: ILogger;

  /** True while a turn is live: a say against the tip has a live acceptance and is rejected. */
  public setBusy(busy: boolean): void {
    throw new Error('not implemented');
  }

  /** The bus serve handler body: parse the request, route it, return the reply bytes. */
  public handle(payload: Uint8Array): Uint8Array {
    throw new Error('not implemented');
  }
}
