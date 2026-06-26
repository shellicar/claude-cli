import type { AccountLimitListener } from '@shellicar/claude-sdk';
import type { ConversationState } from './ConversationState.js';

/**
 * Renders account-limit retry signals as a single persistent notice. The retry loop
 * raises `retrying()` on every capped 429, but the displayed notice is spliced once
 * per episode (gated by #active) so it is refreshed, not relined each minute.
 * `stopped()` splices the give-up notice; `cleared()` (ESC cancel) resets the gate.
 */
export class AccountLimitNotice implements AccountLimitListener {
  #active = false;

  public constructor(private readonly conversation: ConversationState) {}

  public retrying(): void {
    throw new Error('not implemented');
  }

  public stopped(): void {
    throw new Error('not implemented');
  }

  public cleared(): void {
    throw new Error('not implemented');
  }
}
