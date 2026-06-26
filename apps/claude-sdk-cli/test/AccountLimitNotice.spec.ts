import { describe, expect, it } from 'vitest';
import { AccountLimitNotice } from '../src/model/AccountLimitNotice.js';
import { ConversationState } from '../src/model/ConversationState.js';

const RETRYING = '⏳ Account limit — retrying';
const STOPPED = '🛑 Account limit — stopped';

// Fake ConversationState that records the notices spliced into it, so the
// gating logic can be verified without the real append-only state.
class RecordingConversationState extends ConversationState {
  public readonly notices: string[] = [];

  public override spliceNotice(text: string): void {
    this.notices.push(text);
  }
}

// ---------------------------------------------------------------------------
// AccountLimitNotice — every 429 raises the notice, shown on every retry (no gate)
// ---------------------------------------------------------------------------

describe('AccountLimitNotice', () => {
  it('splices the retrying notice on a retrying call', () => {
    const conversation = new RecordingConversationState();
    const notice = new AccountLimitNotice(conversation);

    notice.retrying();

    const actual = conversation.notices;
    expect(actual).toEqual([RETRYING]);
  });

  it('splices the retrying notice on every retry without de-duplication', () => {
    const conversation = new RecordingConversationState();
    const notice = new AccountLimitNotice(conversation);

    notice.retrying();
    notice.retrying();
    notice.retrying();

    const actual = conversation.notices;
    expect(actual).toEqual([RETRYING, RETRYING, RETRYING]);
  });

  it('splices the stopped notice on give-up', () => {
    const conversation = new RecordingConversationState();
    const notice = new AccountLimitNotice(conversation);

    notice.stopped();

    const actual = conversation.notices;
    expect(actual).toEqual([STOPPED]);
  });
});
