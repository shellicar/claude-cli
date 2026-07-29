import { describe, expect, it } from 'vitest';
import type { AuditSummary } from '../src/conversations/scanAuditSummary.js';
import { ConversationListState } from '../src/model/ConversationListState.js';

const summaryOf = (overrides: Partial<AuditSummary> = {}): AuditSummary => ({
  turns: 1,
  queries: 1,
  costUsd: 1,
  firstUtc: '2026-07-28T10:00:00.000Z',
  lastUtc: '2026-07-28T10:01:00.000Z',
  model: 'claude-sonnet-5',
  contextTokens: 100,
  firstUserText: 'the opening ask',
  lastAssistantText: 'the reply',
  ...overrides,
});

const listOf = (...ids: string[]): ConversationListState => {
  const state = new ConversationListState();
  state.setEntries(ids);
  return state;
};

describe('ConversationListState — entries', () => {
  it('lists one entry per conversation id', () => {
    const state = listOf('conv-a', 'conv-b');
    const expected = 2;
    const actual = state.entries.length;
    expect(actual).toBe(expected);
  });

  it('starts an entry with no summary, so the view can paint before the audit is read', () => {
    const state = listOf('conv-a');
    const actual = state.entries[0]?.summary;
    expect(actual).toBeUndefined();
  });

  it('selects the newest conversation on first load', () => {
    const state = listOf('conv-a', 'conv-b');
    const expected = 0;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('keeps the selection on the same conversation when the list is rebuilt', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('next');
    state.setEntries(['conv-new', 'conv-a', 'conv-b']);
    const expected = 'conv-b';
    const actual = state.selectedEntry?.id;
    expect(actual).toBe(expected);
  });

  it('falls back to the newest when the selected conversation is gone', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('next');
    state.setEntries(['conv-a']);
    const expected = 'conv-a';
    const actual = state.selectedEntry?.id;
    expect(actual).toBe(expected);
  });

  it('keeps a summary already loaded when the list is rebuilt', () => {
    const state = listOf('conv-a');
    state.setSummary('conv-a', summaryOf({ costUsd: 4.2 }));
    state.setEntries(['conv-a', 'conv-b']);
    const expected = 4.2;
    const actual = state.entries[0]?.summary?.costUsd;
    expect(actual).toBe(expected);
  });
});

describe('ConversationListState — setSummary', () => {
  it('lands the summary against its conversation', () => {
    const state = listOf('conv-a', 'conv-b');
    state.setSummary('conv-b', summaryOf({ costUsd: 9.5 }));
    const expected = 9.5;
    const actual = state.entries.find((entry) => entry.id === 'conv-b')?.summary?.costUsd;
    expect(actual).toBe(expected);
  });

  it('leaves other entries unfilled', () => {
    const state = listOf('conv-a', 'conv-b');
    state.setSummary('conv-b', summaryOf());
    const actual = state.entries.find((entry) => entry.id === 'conv-a')?.summary;
    expect(actual).toBeUndefined();
  });

  it('ignores a summary for a conversation no longer listed', () => {
    const state = listOf('conv-a');
    state.setEntries(['conv-b']);
    state.setSummary('conv-a', summaryOf());
    const actual = state.entries[0]?.summary;
    expect(actual).toBeUndefined();
  });
});

describe('ConversationListState — order', () => {
  it('puts the most recently active conversation first', () => {
    const state = listOf('conv-old', 'conv-new');
    state.setSummary('conv-old', summaryOf({ lastUtc: '2026-07-28T10:00:00.000Z' }));
    state.setSummary('conv-new', summaryOf({ lastUtc: '2026-07-28T13:00:00.000Z' }));
    const expected = 'conv-new';
    const actual = state.entries[0]?.id;
    expect(actual).toBe(expected);
  });

  it('puts a conversation whose summary has not loaded last, so the list can be shown before it is read', () => {
    const state = listOf('conv-unread', 'conv-known');
    state.setSummary('conv-known', summaryOf({ lastUtc: '2026-07-28T10:00:00.000Z' }));
    const expected = 'conv-unread';
    const actual = state.entries[1]?.id;
    expect(actual).toBe(expected);
  });

  it('keeps the selection on its conversation when a summary reorders the list', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('next');
    const selectedBefore = state.selectedEntry?.id;
    state.setSummary('conv-b', summaryOf({ lastUtc: '2026-07-28T13:00:00.000Z' }));
    const actual = state.selectedEntry?.id;
    expect(actual).toBe(selectedBefore);
  });
});

describe('ConversationListState — selection', () => {
  it('moves down the list', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('next');
    const expected = 1;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('stays put at the bottom', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('next');
    state.apply('next');
    const expected = 1;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('stays put at the top', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('prev');
    const expected = 0;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('moves a page at a time', () => {
    const state = listOf('a', 'b', 'c', 'd', 'e', 'f', 'g');
    state.apply('page-down');
    const expected = 5;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('clamps a page move to the last conversation', () => {
    const state = listOf('a', 'b', 'c');
    state.apply('page-down');
    const expected = 2;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('jumps to the last conversation on end', () => {
    const state = listOf('a', 'b', 'c');
    state.apply('end');
    const expected = 2;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('jumps to the first conversation on home', () => {
    const state = listOf('a', 'b', 'c');
    state.apply('end');
    state.apply('home');
    const expected = 0;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });

  it('does not move on an empty list', () => {
    const state = listOf();
    state.apply('next');
    const expected = 0;
    const actual = state.selected;
    expect(actual).toBe(expected);
  });
});

describe('ConversationListState — entry', () => {
  it('opens on the conversation asked for rather than the top of the list', () => {
    const state = listOf('conv-a', 'conv-b');
    state.enterAt('conv-b');
    const expected = 'conv-b';
    const actual = state.selectedEntry?.id;
    expect(actual).toBe(expected);
  });

  it('stays on that conversation when the rebuilt list reorders around it', () => {
    const state = listOf('conv-a', 'conv-b');
    state.enterAt('conv-b');
    state.setEntries(['conv-new', 'conv-a', 'conv-b']);
    const expected = 'conv-b';
    const actual = state.selectedEntry?.id;
    expect(actual).toBe(expected);
  });

  it('stays on that conversation when a summary lands and reorders the list', () => {
    const state = listOf('conv-a', 'conv-b');
    state.enterAt('conv-b');
    state.setSummary('conv-a', summaryOf({ lastUtc: '2026-07-29T13:00:00.000Z' }));
    const expected = 'conv-b';
    const actual = state.selectedEntry?.id;
    expect(actual).toBe(expected);
  });

  it('follows the operator once they move off it', () => {
    const state = listOf('conv-a', 'conv-b');
    state.enterAt('conv-b');
    state.apply('prev');
    state.setEntries(['conv-a', 'conv-b']);
    const expected = 'conv-a';
    const actual = state.selectedEntry?.id;
    expect(actual).toBe(expected);
  });

  it('opens at the top when the conversation asked for is not listed', () => {
    const state = listOf('conv-a', 'conv-b');
    state.enterAt('conv-elsewhere');
    const expected = 'conv-a';
    const actual = state.selectedEntry?.id;
    expect(actual).toBe(expected);
  });

  it('folds any open peek', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('toggle-peek');
    state.enterAt('conv-b');
    const expected = false;
    const actual = state.peeked;
    expect(actual).toBe(expected);
  });
});

describe('ConversationListState — peek', () => {
  it('opens the peek on the selected conversation', () => {
    const state = listOf('conv-a');
    state.apply('toggle-peek');
    const expected = true;
    const actual = state.peeked;
    expect(actual).toBe(expected);
  });

  it('closes the peek when toggled again', () => {
    const state = listOf('conv-a');
    state.apply('toggle-peek');
    state.apply('toggle-peek');
    const expected = false;
    const actual = state.peeked;
    expect(actual).toBe(expected);
  });

  it('stays open when the selection moves', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('toggle-peek');
    state.apply('next');
    const expected = true;
    const actual = state.peeked;
    expect(actual).toBe(expected);
  });

  it('drops the content of the conversation moved away from', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('toggle-peek');
    state.setPeek('conv-a', { entries: [{ kind: 'user', text: 'from conv-a', toolCount: 0, timestampUtc: null }], earlier: 0 });
    state.apply('next');
    const actual = state.peek;
    expect(actual).toBeUndefined();
  });

  it('ignores content that lands for the conversation just moved away from', () => {
    const state = listOf('conv-a', 'conv-b');
    state.apply('toggle-peek');
    state.apply('next');
    state.setPeek('conv-a', { entries: [{ kind: 'user', text: 'from conv-a', toolCount: 0, timestampUtc: null }], earlier: 0 });
    const actual = state.peek;
    expect(actual).toBeUndefined();
  });

  it('does not peek an empty list', () => {
    const state = listOf();
    state.apply('toggle-peek');
    const expected = false;
    const actual = state.peeked;
    expect(actual).toBe(expected);
  });

  it('folds the peek on reset', () => {
    const state = listOf('conv-a');
    state.apply('toggle-peek');
    state.reset();
    const expected = false;
    const actual = state.peeked;
    expect(actual).toBe(expected);
  });
});
