import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import { IRequestMessageListener } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { IConversationSession } from '../model/ConversationSession.js';
import { IMessageCommitter } from './ConvCommitter.js';
import { IMessageScope } from './MessageScope.js';
import { ICurrentQueryId, ICurrentSender } from './QueryScope.js';
import { ICurrentTurnId } from './TurnScope.js';

/**
 * Records the message a request is about to carry, in the audit and on `changes.message`, under one
 * minted id. The SDK calls this once per request, before the request is made, so the record holds what
 * the model was given rather than what the conversation array happened to hold at some other moment.
 */
export class SentMessageRecorder extends IRequestMessageListener {
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;
  @dependsOn(IMessageCommitter) private readonly commit!: IMessageCommitter;
  @dependsOn(IMessageScope) private readonly messages!: IMessageScope;
  @dependsOn(ICurrentQueryId) private readonly query!: ICurrentQueryId;
  @dependsOn(ICurrentTurnId) private readonly turn!: ICurrentTurnId;
  @dependsOn(ICurrentSender) private readonly sender!: ICurrentSender;

  public sending(msg: BetaMessageParam): void {
    this.commit.commitUser(this.session.id, msg, this.messages.beginUser(), this.query.queryId ?? '', this.turn.turnId ?? '', this.sender.from);
  }
}
