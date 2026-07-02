import { StreamInterruptListener } from '@shellicar/claude-sdk';
import { dependsOn } from '@shellicar/core-di-lite';
import { ConversationState } from './ConversationState.js';

const RECONNECTING = '\u26a0\ufe0f Connection dropped \u2014 reconnecting\u2026';

/**
 * Renders a stream-interruption retry. Seals the partial reply as a finished
 * block (so the streamed output stays on screen and the next attempt can't append
 * onto it), then splices the reconnect line beneath it. Mirrors AccountLimitNotice.
 */
export class StreamInterruptNotice extends StreamInterruptListener {
  @dependsOn(ConversationState) private readonly conversation!: ConversationState;

  public reconnecting(): void {
    this.conversation.completeActive();
    this.conversation.spliceNotice(RECONNECTING);
  }
}
