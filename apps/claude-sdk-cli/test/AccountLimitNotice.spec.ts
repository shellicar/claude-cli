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
// AccountLimitNotice — once-per-episode gating
// ---------------------------------------------------------------------------

describe('AccountLimitNotice', () => {
  it('splices the retrying notice on the first retrying call', () => {
    const conversation = new RecordingConversationState();
    const notice = new AccountLimitNotice(conversation);

    notice.retrying();

    const actual = conversation.notices;
    expect(actual).toEqual([RETRYING]);
  });

  it('does not splice again on a second retrying call', () => {
    const conversation = new RecordingConversationState();
    const notice = new AccountLimitNotice(conversation);

    notice.retrying();
    notice.retrying();

    const actual = conversation.notices.length;
    expect(actual).toBe(1);
  });

  it('splices the stopped notice on give-up', () => {
    const conversation = new RecordingConversationState();
    const notice = new AccountLimitNotice(conversation);

    notice.stopped();

    const actual = conversation.notices;
    expect(actual).toEqual([STOPPED]);
  });

  it('splices the retrying notice again after cleared resets the gate', () => {
    const conversation = new RecordingConversationState();
    const notice = new AccountLimitNotice(conversation);

    notice.retrying();
    notice.cleared();
    notice.retrying();

    const actual = conversation.notices.length;
    expect(actual).toBe(2);
  });
});
