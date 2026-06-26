import type { AccountLimitListener } from '@shellicar/claude-sdk';
import type { ConversationState } from './ConversationState.js';

/**
 * Renders account-limit retry signals as a single persistent notice. The retry loop
 * raises `retrying()` on every capped 429, but the displayed notice is spliced once
 * per episode (gated by #active) so it is refreshed, not relined each minute.
 * `stopped()` splices the give-up notice; `cleared()` (ESC cancel) resets the gate.
 */
const RETRYING = '\u23f3 Account limit \u2014 retrying';
const STOPPED = '\uD83D\uDED1 Account limit \u2014 stopped';

export class AccountLimitNotice implements AccountLimitListener {
  #active = false;

  public constructor(private readonly conversation: ConversationState) {}

  public retrying(): void {
    if (this.#active) {
      return;
    }
    this.#active = true;
    this.conversation.spliceNotice(RETRYING);
  }

  public stopped(): void {
    this.conversation.spliceNotice(STOPPED);
    this.#active = false;
  }

  public cleared(): void {
    this.#active = false;
  }
}
