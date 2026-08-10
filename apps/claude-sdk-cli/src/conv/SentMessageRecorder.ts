import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.js';
import { IRequestMessageListener } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di';
import { IConversationSession } from '../model/ConversationSession.js';
import { IMessageCommitter } from './ConvCommitter.js';
import { ICurrentQueryId } from './QueryScope.js';
import { ICurrentTurnId } from './TurnScope.js';

/**
 * Writes the message a request is about to carry to the audit. The SDK calls this once per request,
 * before the request is made, so the audit holds what the model was given rather than what the
 * conversation array happened to hold at some other moment.
 */
export class SentMessageRecorder extends IRequestMessageListener {
  @dependsOn(IConversationSession) private readonly session!: IConversationSession;
  @dependsOn(IMessageCommitter) private readonly commit!: IMessageCommitter;
  @dependsOn(ICurrentQueryId) private readonly query!: ICurrentQueryId;
  @dependsOn(ICurrentTurnId) private readonly turn!: ICurrentTurnId;

  public sending(msg: BetaMessageParam): void {
    this.commit.recordSent(this.session.id, msg, this.query.queryId ?? '', this.turn.turnId ?? '');
  }
}
