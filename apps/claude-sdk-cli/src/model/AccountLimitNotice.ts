import type { AccountLimitListener } from '@shellicar/claude-sdk';
import type { ConversationState } from './ConversationState.js';

const RETRYING = '\u23f3 Account limit \u2014 retrying';
const STOPPED = '\uD83D\uDED1 Account limit \u2014 stopped';

/**
 * Renders account-limit retry signals as notices. Every 429 raises a notice: the
 * retry loop calls `retrying()` on each capped 429 and the ⏳ line is spliced on
 * every retry — no de-duplication, no gate. `stopped()` splices the 🛑 give-up
 * line.
 */
export class AccountLimitNotice implements AccountLimitListener {
  public constructor(private readonly conversation: ConversationState) {}

  public retrying(): void {
    this.conversation.spliceNotice(RETRYING);
  }

  public stopped(): void {
    this.conversation.spliceNotice(STOPPED);
  }
}
